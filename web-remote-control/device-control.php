<?php
// device-control.php - Interface de contrôle à distance pour les appareils Fire TV

// Configuration de la base de données (adaptez selon votre configuration)
require_once('dbpdointranet.php');
$dbpdointranet->exec("USE affichageDynamique");

// Récupérer l'ID de l'appareil depuis l'URL
$device_id = $_GET['device_id'] ?? '';

if (empty($device_id)) {
    die('ID d\'appareil requis');
}

// Récupérer les informations de l'appareil
$stmt = $dbpdointranet->prepare("
    SELECT a.*, p.nom as presentation_defaut_nom
    FROM appareils a
    LEFT JOIN presentations p ON a.presentation_defaut_id = p.id
    WHERE a.identifiant_unique = ?
");
$stmt->execute([$device_id]);
$appareil = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$appareil) {
    die('Appareil non trouvé');
}

// Récupérer les présentations disponibles pour assignation
$stmt = $dbpdointranet->query("
    SELECT id, nom, description 
    FROM presentations 
    WHERE statut = 'actif' 
    ORDER BY nom
");
$presentations = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Récupérer les commandes récentes
$stmt = $dbpdointranet->prepare("
    SELECT * FROM commandes_distantes 
    WHERE identifiant_appareil = ? 
    ORDER BY date_creation DESC 
    LIMIT 10
");
$stmt->execute([$device_id]);
$commandes_recentes = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>

<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Contrôle à distance - <?= htmlspecialchars($appareil['nom']) ?></title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .status-indicator {
            animation: pulse 2s infinite;
        }
        
        .command-button {
            transition: all 0.3s ease;
        }
        
        .command-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        }
        
        .command-button:active {
            transform: translateY(0);
        }
        
        .status-online { color: #10b981; }
        .status-offline { color: #6b7280; }
        .status-playing { color: #3b82f6; }
        .status-paused { color: #f59e0b; }
        .status-error { color: #ef4444; }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        
        .notification {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1000;
            padding: 16px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            transform: translateX(100%);
            transition: transform 0.3s ease;
        }
        
        .notification.show {
            transform: translateX(0);
        }
        
        .notification.success { background-color: #10b981; }
        .notification.error { background-color: #ef4444; }
        .notification.info { background-color: #3b82f6; }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <!-- Notification -->
    <div id="notification" class="notification">
        <span id="notification-message"></span>
    </div>

    <div class="container mx-auto px-4 py-8">
        <!-- En-tête de l'appareil -->
        <div class="bg-white rounded-lg shadow-lg p-6 mb-8">
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                    <div class="bg-blue-100 p-3 rounded-full">
                        <i class="fas fa-tv text-blue-600 text-2xl"></i>
                    </div>
                    <div>
                        <h1 class="text-2xl font-bold text-gray-800"><?= htmlspecialchars($appareil['nom']) ?></h1>
                        <p class="text-gray-600">ID: <?= htmlspecialchars($appareil['identifiant_unique']) ?></p>
                        <p class="text-sm text-gray-500">
                            Dernière connexion: <?= date('d/m/Y H:i:s', strtotime($appareil['derniere_connexion'])) ?>
                        </p>
                    </div>
                </div>
                
                <div class="text-right">
                    <div class="flex items-center space-x-2 mb-2">
                        <span class="text-sm font-medium">Statut:</span>
                        <span id="device-status" class="status-indicator font-bold">
                            <i class="fas fa-circle"></i>
                            <span id="status-text"><?= ucfirst($appareil['statut_temps_reel'] ?? 'offline') ?></span>
                        </span>
                    </div>
                    
                    <?php if (!empty($appareil['presentation_courante_nom'])): ?>
                    <div class="text-sm text-gray-600">
                        <i class="fas fa-play-circle"></i>
                        En cours: <?= htmlspecialchars($appareil['presentation_courante_nom']) ?>
                    </div>
                    <?php endif; ?>
                    
                    <button onclick="refreshStatus()" class="mt-2 text-blue-600 hover:text-blue-800 text-sm">
                        <i class="fas fa-sync-alt"></i> Actualiser
                    </button>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Contrôles de lecture -->
            <div class="lg:col-span-2">
                <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-gamepad text-blue-600"></i>
                        Contrôles de lecture
                    </h2>
                    
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <button onclick="sendCommand('play')" class="command-button bg-green-500 hover:bg-green-600 text-white p-4 rounded-lg">
                            <i class="fas fa-play text-2xl mb-2"></i>
                            <div class="text-sm font-medium">Lecture</div>
                        </button>
                        
                        <button onclick="sendCommand('pause')" class="command-button bg-yellow-500 hover:bg-yellow-600 text-white p-4 rounded-lg">
                            <i class="fas fa-pause text-2xl mb-2"></i>
                            <div class="text-sm font-medium">Pause</div>
                        </button>
                        
                        <button onclick="sendCommand('stop')" class="command-button bg-red-500 hover:bg-red-600 text-white p-4 rounded-lg">
                            <i class="fas fa-stop text-2xl mb-2"></i>
                            <div class="text-sm font-medium">Arrêt</div>
                        </button>
                        
                        <button onclick="sendCommand('restart')" class="command-button bg-blue-500 hover:bg-blue-600 text-white p-4 rounded-lg">
                            <i class="fas fa-redo text-2xl mb-2"></i>
                            <div class="text-sm font-medium">Redémarrer</div>
                        </button>
                    </div>
                </div>

                <!-- Navigation des slides -->
                <div class="bg-white rounded-lg shadow-lg p-6 mb-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-arrows-alt-h text-purple-600"></i>
                        Navigation
                    </h2>
                    
                    <div class="grid grid-cols-3 gap-4">
                        <button onclick="sendCommand('prev_slide')" class="command-button bg-purple-500 hover:bg-purple-600 text-white p-4 rounded-lg">
                            <i class="fas fa-chevron-left text-xl mb-2"></i>
                            <div class="text-sm font-medium">Slide précédente</div>
                        </button>
                        
                        <div class="flex flex-col space-y-2">
                            <input type="number" id="slide-number" placeholder="N° slide" min="1" 
                                   class="border border-gray-300 rounded px-3 py-2 text-center">
                            <button onclick="goToSlide()" class="command-button bg-indigo-500 hover:bg-indigo-600 text-white p-2 rounded">
                                <i class="fas fa-crosshairs"></i> Aller à
                            </button>
                        </div>
                        
                        <button onclick="sendCommand('next_slide')" class="command-button bg-purple-500 hover:bg-purple-600 text-white p-4 rounded-lg">
                            <i class="fas fa-chevron-right text-xl mb-2"></i>
                            <div class="text-sm font-medium">Slide suivante</div>
                        </button>
                    </div>
                </div>

                <!-- Assignation de présentation -->
                <div class="bg-white rounded-lg shadow-lg p-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-desktop text-green-600"></i>
                        Assigner une présentation
                    </h2>
                    
                    <div class="space-y-4">
                        <select id="presentation-select" class="w-full border border-gray-300 rounded-lg px-4 py-2">
                            <option value="">Sélectionnez une présentation</option>
                            <?php foreach ($presentations as $presentation): ?>
                            <option value="<?= $presentation['id'] ?>">
                                <?= htmlspecialchars($presentation['nom']) ?>
                                <?php if ($presentation['description']): ?>
                                - <?= htmlspecialchars(substr($presentation['description'], 0, 50)) ?>...
                                <?php endif; ?>
                            </option>
                            <?php endforeach; ?>
                        </select>
                        
                        <div class="flex space-x-4">
                            <label class="flex items-center">
                                <input type="checkbox" id="auto-play" checked class="mr-2">
                                <span class="text-sm">Lecture automatique</span>
                            </label>
                            <label class="flex items-center">
                                <input type="checkbox" id="loop-mode" checked class="mr-2">
                                <span class="text-sm">Mode boucle</span>
                            </label>
                        </div>
                        
                        <button onclick="assignPresentation()" class="w-full command-button bg-green-500 hover:bg-green-600 text-white p-3 rounded-lg">
                            <i class="fas fa-paper-plane mr-2"></i>
                            Assigner et lancer
                        </button>
                    </div>
                </div>
            </div>

            <!-- Panneau latéral -->
            <div class="space-y-6">
                <!-- Actions système -->
                <div class="bg-white rounded-lg shadow-lg p-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-cogs text-orange-600"></i>
                        Actions système
                    </h2>
                    
                    <div class="space-y-3">
                        <button onclick="sendCommand('reboot')" class="w-full command-button bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-lg">
                            <i class="fas fa-power-off mr-2"></i>
                            Redémarrer l'appareil
                        </button>
                        
                        <button onclick="sendCommand('update_app')" class="w-full command-button bg-blue-500 hover:bg-blue-600 text-white p-3 rounded-lg">
                            <i class="fas fa-download mr-2"></i>
                            Mettre à jour l'app
                        </button>
                    </div>
                </div>

                <!-- Informations en temps réel -->
                <div class="bg-white rounded-lg shadow-lg p-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-chart-line text-blue-600"></i>
                        Informations temps réel
                    </h2>
                    
                    <div class="space-y-3 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600">Présentation:</span>
                            <span id="current-presentation" class="font-medium">
                                <?= htmlspecialchars($appareil['presentation_courante_nom'] ?? 'Aucune') ?>
                            </span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Slide:</span>
                            <span id="current-slide" class="font-medium">
                                <?php if ($appareil['slide_courant_index'] !== null && $appareil['total_slides']): ?>
                                    <?= ($appareil['slide_courant_index'] + 1) ?> / <?= $appareil['total_slides'] ?>
                                <?php else: ?>
                                    -
                                <?php endif; ?>
                            </span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Mode boucle:</span>
                            <span id="loop-status" class="font-medium">
                                <?= $appareil['mode_boucle'] ? 'Activé' : 'Désactivé' ?>
                            </span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">Mémoire:</span>
                            <span id="memory-usage" class="font-medium">
                                <?= $appareil['utilisation_memoire'] ? $appareil['utilisation_memoire'] . '%' : '-' ?>
                            </span>
                        </div>
                        
                        <div class="flex justify-between">
                            <span class="text-gray-600">WiFi:</span>
                            <span id="wifi-strength" class="font-medium">
                                <?= $appareil['force_wifi'] ? $appareil['force_wifi'] . '%' : '-' ?>
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Historique des commandes -->
                <div class="bg-white rounded-lg shadow-lg p-6">
                    <h2 class="text-xl font-bold text-gray-800 mb-4">
                        <i class="fas fa-history text-gray-600"></i>
                        Commandes récentes
                    </h2>
                    
                    <div id="command-history" class="space-y-2 max-h-64 overflow-y-auto">
                        <?php foreach ($commandes_recentes as $commande): ?>
                        <div class="flex items-center justify-between text-sm p-2 bg-gray-50 rounded">
                            <span class="font-medium"><?= htmlspecialchars($commande['commande']) ?></span>
                            <span class="text-xs text-gray-500">
                                <?= date('H:i:s', strtotime($commande['date_creation'])) ?>
                            </span>
                            <span class="text-xs px-2 py-1 rounded 
                                <?php 
                                switch($commande['statut']) {
                                    case 'executee': echo 'bg-green-100 text-green-800'; break;
                                    case 'en_attente': echo 'bg-yellow-100 text-yellow-800'; break;
                                    case 'echouee': echo 'bg-red-100 text-red-800'; break;
                                    default: echo 'bg-gray-100 text-gray-800';
                                }
                                ?>">
                                <?= htmlspecialchars($commande['statut']) ?>
                            </span>
                        </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const deviceId = '<?= $device_id ?>';
        let statusInterval;

        // Démarrer la surveillance du statut
        document.addEventListener('DOMContentLoaded', function() {
            refreshStatus();
            statusInterval = setInterval(refreshStatus, 10000); // Actualiser toutes les 10 secondes
        });

        // Fonction pour afficher les notifications
        function showNotification(message, type = 'info') {
            const notification = document.getElementById('notification');
            const messageElement = document.getElementById('notification-message');
            
            messageElement.textContent = message;
            notification.className = `notification ${type}`;
            notification.classList.add('show');
            
            setTimeout(() => {
                notification.classList.remove('show');
            }, 3000);
        }

        // Envoyer une commande à l'appareil
        async function sendCommand(command, parameters = {}) {
            try {
                const response = await fetch('remote-control-api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'send_command',
                        device_id: deviceId,
                        command: command,
                        parameters: parameters
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    showNotification(`Commande "${command}" envoyée avec succès`, 'success');
                    refreshCommandHistory();
                } else {
                    showNotification(`Erreur: ${result.message}`, 'error');
                }
            } catch (error) {
                console.error('Erreur lors de l\'envoi de la commande:', error);
                showNotification('Erreur de communication avec le serveur', 'error');
            }
        }

        // Aller à une slide spécifique
        function goToSlide() {
            const slideNumber = document.getElementById('slide-number').value;
            if (slideNumber && slideNumber > 0) {
                sendCommand('goto_slide', { slide_index: parseInt(slideNumber) - 1 });
                document.getElementById('slide-number').value = '';
            } else {
                showNotification('Veuillez entrer un numéro de slide valide', 'error');
            }
        }

        // Assigner une présentation
        function assignPresentation() {
            const presentationId = document.getElementById('presentation-select').value;
            const autoPlay = document.getElementById('auto-play').checked;
            const loopMode = document.getElementById('loop-mode').checked;
            
            if (!presentationId) {
                showNotification('Veuillez sélectionner une présentation', 'error');
                return;
            }
            
            sendCommand('assign_presentation', {
                presentation_id: parseInt(presentationId),
                auto_play: autoPlay,
                loop_mode: loopMode
            });
        }

        // Actualiser le statut de l'appareil
        async function refreshStatus() {
            try {
                const response = await fetch('remote-control-api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'get_status',
                        device_id: deviceId
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    updateStatusDisplay(result.data);
                }
            } catch (error) {
                console.error('Erreur lors de la récupération du statut:', error);
            }
        }

        // Mettre à jour l'affichage du statut
        function updateStatusDisplay(data) {
            const statusElement = document.getElementById('device-status');
            const statusText = document.getElementById('status-text');
            
            // Mettre à jour le statut principal
            statusText.textContent = data.statut_temps_reel || 'offline';
            statusElement.className = `status-indicator font-bold status-${data.statut_temps_reel || 'offline'}`;
            
            // Mettre à jour les informations temps réel
            document.getElementById('current-presentation').textContent = 
                data.presentation_courante_nom || 'Aucune';
            
            if (data.slide_courant_index !== null && data.total_slides) {
                document.getElementById('current-slide').textContent = 
                    `${data.slide_courant_index + 1} / ${data.total_slides}`;
            } else {
                document.getElementById('current-slide').textContent = '-';
            }
            
            document.getElementById('loop-status').textContent = 
                data.mode_boucle ? 'Activé' : 'Désactivé';
            
            document.getElementById('memory-usage').textContent = 
                data.utilisation_memoire ? `${data.utilisation_memoire}%` : '-';
            
            document.getElementById('wifi-strength').textContent = 
                data.force_wifi ? `${data.force_wifi}%` : '-';
        }

        // Actualiser l'historique des commandes
        async function refreshCommandHistory() {
            try {
                const response = await fetch('remote-control-api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'get_command_history',
                        device_id: deviceId
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    updateCommandHistory(result.data);
                }
            } catch (error) {
                console.error('Erreur lors de la récupération de l\'historique:', error);
            }
        }

        // Mettre à jour l'affichage de l'historique
        function updateCommandHistory(commands) {
            const historyElement = document.getElementById('command-history');
            historyElement.innerHTML = '';
            
            commands.forEach(command => {
                const div = document.createElement('div');
                div.className = 'flex items-center justify-between text-sm p-2 bg-gray-50 rounded';
                
                let statusClass = 'bg-gray-100 text-gray-800';
                switch(command.statut) {
                    case 'executee': statusClass = 'bg-green-100 text-green-800'; break;
                    case 'en_attente': statusClass = 'bg-yellow-100 text-yellow-800'; break;
                    case 'echouee': statusClass = 'bg-red-100 text-red-800'; break;
                }
                
                div.innerHTML = `
                    <span class="font-medium">${command.commande}</span>
                    <span class="text-xs text-gray-500">${new Date(command.date_creation).toLocaleTimeString()}</span>
                    <span class="text-xs px-2 py-1 rounded ${statusClass}">${command.statut}</span>
                `;
                
                historyElement.appendChild(div);
            });
        }

        // Nettoyer l'intervalle quand on quitte la page
        window.addEventListener('beforeunload', function() {
            if (statusInterval) {
                clearInterval(statusInterval);
            }
        });
    </script>
</body>
</html>
<?php
// device-list.php - Liste des appareils avec leur statut

// Configuration de la base de données
require_once('dbpdointranet.php');
$dbpdointranet->exec("USE affichageDynamique");

// Récupérer tous les appareils avec leur statut
$stmt = $dbpdointranet->query("
    SELECT 
        a.*,
        p.nom as presentation_courante_nom,
        CASE 
            WHEN a.derniere_connexion > DATE_SUB(NOW(), INTERVAL 2 MINUTE) THEN 'online'
            WHEN a.derniere_connexion > DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 'idle'
            ELSE 'offline'
        END as statut_connexion,
        TIMESTAMPDIFF(SECOND, a.derniere_connexion, NOW()) as secondes_depuis_derniere_connexion
    FROM appareils a
    LEFT JOIN presentations p ON a.presentation_courante_id = p.id
    ORDER BY a.derniere_connexion DESC
");
$appareils = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Récupérer les statistiques
$stmt = $dbpdointranet->query("
    SELECT 
        COUNT(*) as total_appareils,
        SUM(CASE WHEN derniere_connexion > DATE_SUB(NOW(), INTERVAL 2 MINUTE) THEN 1 ELSE 0 END) as appareils_en_ligne,
        SUM(CASE WHEN statut_temps_reel = 'playing' THEN 1 ELSE 0 END) as appareils_en_diffusion,
        COUNT(DISTINCT presentation_courante_id) as presentations_actives
    FROM appareils
    WHERE statut = 'actif'
");
$stats = $stmt->fetch(PDO::FETCH_ASSOC);

// Récupérer les commandes en attente
$stmt = $dbpdointranet->query("
    SELECT COUNT(*) as commandes_en_attente
    FROM commandes_distantes 
    WHERE statut = 'en_attente'
");
$commandes = $stmt->fetch(PDO::FETCH_ASSOC);
$stats['commandes_en_attente'] = $commandes['commandes_en_attente'];
?>

<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestion des appareils Fire TV</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .status-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            display: inline-block;
            margin-right: 6px;
        }
        
        .status-online { background-color: #10b981; }
        .status-idle { background-color: #f59e0b; }
        .status-offline { background-color: #6b7280; }
        .status-playing { background-color: #3b82f6; }
        .status-paused { background-color: #f59e0b; }
        .status-error { background-color: #ef4444; }
        
        .device-card {
            transition: transform 0.2s ease;
        }
        
        .device-card:hover {
            transform: translateY(-5px);
        }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-8">
            <i class="fas fa-tv text-blue-600"></i>
            Gestion des appareils Fire TV
        </h1>

        <!-- Statistiques -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-center">
                    <div class="bg-blue-100 p-3 rounded-full">
                        <i class="fas fa-tv text-blue-600 text-xl"></i>
                    </div>
                    <div class="ml-4">
                        <p class="text-gray-500 text-sm">Appareils totaux</p>
                        <p class="text-2xl font-bold text-gray-800"><?= $stats['total_appareils'] ?></p>
                    </div>
                </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-center">
                    <div class="bg-green-100 p-3 rounded-full">
                        <i class="fas fa-wifi text-green-600 text-xl"></i>
                    </div>
                    <div class="ml-4">
                        <p class="text-gray-500 text-sm">Appareils en ligne</p>
                        <p class="text-2xl font-bold text-gray-800"><?= $stats['appareils_en_ligne'] ?></p>
                    </div>
                </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-center">
                    <div class="bg-indigo-100 p-3 rounded-full">
                        <i class="fas fa-play text-indigo-600 text-xl"></i>
                    </div>
                    <div class="ml-4">
                        <p class="text-gray-500 text-sm">En diffusion</p>
                        <p class="text-2xl font-bold text-gray-800"><?= $stats['appareils_en_diffusion'] ?></p>
                    </div>
                </div>
            </div>
            
            <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-center">
                    <div class="bg-yellow-100 p-3 rounded-full">
                        <i class="fas fa-clock text-yellow-600 text-xl"></i>
                    </div>
                    <div class="ml-4">
                        <p class="text-gray-500 text-sm">Commandes en attente</p>
                        <p class="text-2xl font-bold text-gray-800"><?= $stats['commandes_en_attente'] ?></p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Filtres -->
        <div class="bg-white rounded-lg shadow p-4 mb-8">
            <div class="flex flex-wrap items-center gap-4">
                <div class="flex-grow">
                    <input type="text" id="search-input" placeholder="Rechercher un appareil..." 
                           class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                </div>
                
                <div class="flex items-center space-x-4">
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" id="filter-online" checked>
                        <span>En ligne</span>
                    </label>
                    
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" id="filter-offline" checked>
                        <span>Hors ligne</span>
                    </label>
                    
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" id="filter-playing" checked>
                        <span>En diffusion</span>
                    </label>
                </div>
                
                <button id="refresh-button" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
                    <i class="fas fa-sync-alt mr-2"></i>
                    Actualiser
                </button>
            </div>
        </div>

        <!-- Liste des appareils -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" id="devices-container">
            <?php foreach ($appareils as $appareil): ?>
            <div class="device-card bg-white rounded-lg shadow-lg overflow-hidden" 
                 data-status="<?= $appareil['statut_temps_reel'] ?? 'offline' ?>"
                 data-name="<?= htmlspecialchars($appareil['nom']) ?>">
                <div class="p-6">
                    <div class="flex justify-between items-start mb-4">
                        <div>
                            <h2 class="text-xl font-bold text-gray-800"><?= htmlspecialchars($appareil['nom']) ?></h2>
                            <p class="text-sm text-gray-600"><?= htmlspecialchars($appareil['identifiant_unique']) ?></p>
                        </div>
                        
                        <div class="flex items-center">
                            <span class="status-indicator status-<?= $appareil['statut_temps_reel'] ?? 'offline' ?>"></span>
                            <span class="text-sm font-medium">
                                <?= ucfirst($appareil['statut_temps_reel'] ?? 'offline') ?>
                            </span>
                        </div>
                    </div>
                    
                    <div class="space-y-2 text-sm mb-4">
                        <?php if ($appareil['presentation_courante_nom']): ?>
                        <div class="flex items-center">
                            <i class="fas fa-play-circle text-blue-500 mr-2"></i>
                            <span class="text-gray-700">
                                <?= htmlspecialchars($appareil['presentation_courante_nom']) ?>
                            </span>
                        </div>
                        <?php endif; ?>
                        
                        <div class="flex items-center">
                            <i class="fas fa-clock text-gray-500 mr-2"></i>
                            <span class="text-gray-600">
                                <?php
                                $time_diff = $appareil['secondes_depuis_derniere_connexion'];
                                if ($time_diff < 60) {
                                    echo "Il y a {$time_diff} secondes";
                                } elseif ($time_diff < 3600) {
                                    echo "Il y a " . floor($time_diff / 60) . " minutes";
                                } else {
                                    echo "Il y a " . floor($time_diff / 3600) . " heures";
                                }
                                ?>
                            </span>
                        </div>
                        
                        <?php if ($appareil['version_app']): ?>
                        <div class="flex items-center">
                            <i class="fas fa-code-branch text-gray-500 mr-2"></i>
                            <span class="text-gray-600">v<?= htmlspecialchars($appareil['version_app']) ?></span>
                        </div>
                        <?php endif; ?>
                    </div>
                    
                    <div class="flex space-x-2">
                        <a href="device-control.php?device_id=<?= urlencode($appareil['identifiant_unique']) ?>" 
                           class="flex-1 bg-blue-500 hover:bg-blue-600 text-white text-center py-2 px-4 rounded">
                            <i class="fas fa-gamepad mr-1"></i>
                            Contrôler
                        </a>
                        
                        <button onclick="sendQuickCommand('<?= $appareil['identifiant_unique'] ?>', 'play')" 
                                class="bg-green-500 hover:bg-green-600 text-white py-2 px-3 rounded">
                            <i class="fas fa-play"></i>
                        </button>
                        
                        <button onclick="sendQuickCommand('<?= $appareil['identifiant_unique'] ?>', 'pause')" 
                                class="bg-yellow-500 hover:bg-yellow-600 text-white py-2 px-3 rounded">
                            <i class="fas fa-pause"></i>
                        </button>
                        
                        <button onclick="sendQuickCommand('<?= $appareil['identifiant_unique'] ?>', 'stop')" 
                                class="bg-red-500 hover:bg-red-600 text-white py-2 px-3 rounded">
                            <i class="fas fa-stop"></i>
                        </button>
                    </div>
                </div>
            </div>
            <?php endforeach; ?>
        </div>
        
        <!-- Message si aucun appareil -->
        <?php if (count($appareils) === 0): ?>
        <div class="bg-white rounded-lg shadow-lg p-8 text-center">
            <i class="fas fa-tv text-gray-400 text-5xl mb-4"></i>
            <h2 class="text-2xl font-bold text-gray-700 mb-2">Aucun appareil trouvé</h2>
            <p class="text-gray-600">
                Aucun appareil Fire TV n'est enregistré dans le système.
                <br>Connectez un appareil pour commencer.
            </p>
        </div>
        <?php endif; ?>
    </div>

    <script>
        // Fonction pour envoyer une commande rapide
        async function sendQuickCommand(deviceId, command) {
            try {
                const response = await fetch('remote-control-api.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'send_command',
                        device_id: deviceId,
                        command: command
                    })
                });

                const result = await response.json();
                
                if (result.success) {
                    alert(`Commande "${command}" envoyée avec succès à l'appareil`);
                } else {
                    alert(`Erreur: ${result.message}`);
                }
            } catch (error) {
                console.error('Erreur lors de l\'envoi de la commande:', error);
                alert('Erreur de communication avec le serveur');
            }
        }

        // Filtrage des appareils
        document.addEventListener('DOMContentLoaded', function() {
            const searchInput = document.getElementById('search-input');
            const filterOnline = document.getElementById('filter-online');
            const filterOffline = document.getElementById('filter-offline');
            const filterPlaying = document.getElementById('filter-playing');
            const refreshButton = document.getElementById('refresh-button');
            
            // Fonction de filtrage
            function filterDevices() {
                const searchTerm = searchInput.value.toLowerCase();
                const showOnline = filterOnline.checked;
                const showOffline = filterOffline.checked;
                const showPlaying = filterPlaying.checked;
                
                const devices = document.querySelectorAll('#devices-container .device-card');
                
                devices.forEach(device => {
                    const deviceName = device.dataset.name.toLowerCase();
                    const deviceStatus = device.dataset.status;
                    
                    // Filtrer par nom
                    const matchesSearch = deviceName.includes(searchTerm);
                    
                    // Filtrer par statut
                    let matchesStatus = false;
                    if (deviceStatus === 'online' && showOnline) matchesStatus = true;
                    if (deviceStatus === 'offline' && showOffline) matchesStatus = true;
                    if (deviceStatus === 'playing' && showPlaying) matchesStatus = true;
                    if (deviceStatus === 'paused' && showPlaying) matchesStatus = true;
                    
                    // Afficher ou masquer
                    if (matchesSearch && matchesStatus) {
                        device.style.display = 'block';
                    } else {
                        device.style.display = 'none';
                    }
                });
            }
            
            // Événements
            searchInput.addEventListener('input', filterDevices);
            filterOnline.addEventListener('change', filterDevices);
            filterOffline.addEventListener('change', filterDevices);
            filterPlaying.addEventListener('change', filterDevices);
            
            // Actualiser la page
            refreshButton.addEventListener('click', function() {
                location.reload();
            });
            
            // Filtrer au chargement
            filterDevices();
        });
    </script>
</body>
</html>
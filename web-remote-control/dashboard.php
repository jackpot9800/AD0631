<?php
// dashboard.php - Tableau de bord pour la gestion des appareils Fire TV

// Configuration de la base de données
require_once('dbpdointranet.php');
$dbpdointranet->exec("USE affichageDynamique");

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

// Récupérer les appareils en ligne
$stmt = $dbpdointranet->query("
    SELECT 
        a.*,
        p.nom as presentation_courante_nom
    FROM appareils a
    LEFT JOIN presentations p ON a.presentation_courante_id = p.id
    WHERE a.derniere_connexion > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
    ORDER BY a.derniere_connexion DESC
    LIMIT 5
");
$appareils_recents = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Récupérer les commandes récentes
$stmt = $dbpdointranet->query("
    SELECT 
        c.*,
        a.nom as nom_appareil
    FROM commandes_distantes c
    JOIN appareils a ON c.identifiant_appareil = a.identifiant_unique
    ORDER BY c.date_creation DESC
    LIMIT 10
");
$commandes_recentes = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Récupérer les présentations les plus diffusées
$stmt = $dbpdointranet->query("
    SELECT 
        p.id,
        p.nom,
        COUNT(DISTINCT a.id) as nombre_appareils
    FROM presentations p
    JOIN appareils a ON a.presentation_courante_id = p.id
    WHERE a.statut_temps_reel = 'playing'
    GROUP BY p.id, p.nom
    ORDER BY nombre_appareils DESC
    LIMIT 5
");
$presentations_populaires = $stmt->fetchAll(PDO::FETCH_ASSOC);
?>

<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tableau de bord - Gestion Fire TV</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        .status-indicator {
            width: 10px;
            height: 10px;
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
        
        .dashboard-card {
            transition: all 0.3s ease;
        }
        
        .dashboard-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <div class="flex justify-between items-center mb-8">
            <h1 class="text-3xl font-bold text-gray-800">
                <i class="fas fa-tachometer-alt text-blue-600"></i>
                Tableau de bord Fire TV
            </h1>
            
            <div class="flex space-x-4">
                <button id="refresh-button" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg">
                    <i class="fas fa-sync-alt mr-2"></i>
                    Actualiser
                </button>
                
                <a href="device-list.php" class="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg">
                    <i class="fas fa-tv mr-2"></i>
                    Liste des appareils
                </a>
            </div>
        </div>

        <!-- Statistiques -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div class="dashboard-card bg-white rounded-lg shadow p-6">
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
            
            <div class="dashboard-card bg-white rounded-lg shadow p-6">
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
            
            <div class="dashboard-card bg-white rounded-lg shadow p-6">
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
            
            <div class="dashboard-card bg-white rounded-lg shadow p-6">
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

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Graphique de statut -->
            <div class="dashboard-card bg-white rounded-lg shadow-lg p-6 lg:col-span-2">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-chart-pie text-purple-600"></i>
                    Statut des appareils
                </h2>
                
                <div class="h-64">
                    <canvas id="status-chart"></canvas>
                </div>
            </div>

            <!-- Appareils récents -->
            <div class="dashboard-card bg-white rounded-lg shadow-lg p-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-history text-blue-600"></i>
                    Appareils récemment actifs
                </h2>
                
                <div class="space-y-4">
                    <?php foreach ($appareils_recents as $appareil): ?>
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div class="flex items-center">
                            <span class="status-indicator status-<?= $appareil['statut_temps_reel'] ?? 'offline' ?>"></span>
                            <div>
                                <p class="font-medium text-gray-800"><?= htmlspecialchars($appareil['nom']) ?></p>
                                <p class="text-xs text-gray-500">
                                    <?php
                                    $time = new DateTime($appareil['derniere_connexion']);
                                    echo $time->format('H:i:s');
                                    ?>
                                </p>
                            </div>
                        </div>
                        
                        <a href="device-control.php?device_id=<?= urlencode($appareil['identifiant_unique']) ?>" 
                           class="text-blue-500 hover:text-blue-700">
                            <i class="fas fa-gamepad"></i>
                        </a>
                    </div>
                    <?php endforeach; ?>
                    
                    <?php if (count($appareils_recents) === 0): ?>
                    <div class="text-center py-4 text-gray-500">
                        <i class="fas fa-info-circle mb-2 text-xl"></i>
                        <p>Aucun appareil actif récemment</p>
                    </div>
                    <?php endif; ?>
                    
                    <a href="device-list.php" class="block text-center text-blue-500 hover:text-blue-700 mt-4">
                        Voir tous les appareils
                    </a>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
            <!-- Commandes récentes -->
            <div class="dashboard-card bg-white rounded-lg shadow-lg p-6 lg:col-span-2">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-terminal text-gray-600"></i>
                    Commandes récentes
                </h2>
                
                <div class="overflow-x-auto">
                    <table class="min-w-full">
                        <thead>
                            <tr class="bg-gray-50">
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Appareil</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Commande</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Statut</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            <?php foreach ($commandes_recentes as $commande): ?>
                            <tr>
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    <?= htmlspecialchars($commande['nom_appareil']) ?>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span class="px-2 py-1 rounded 
                                        <?php 
                                        switch($commande['commande']) {
                                            case 'play': echo 'bg-green-100 text-green-800'; break;
                                            case 'pause': echo 'bg-yellow-100 text-yellow-800'; break;
                                            case 'stop': echo 'bg-red-100 text-red-800'; break;
                                            case 'restart': echo 'bg-blue-100 text-blue-800'; break;
                                            case 'assign_presentation': echo 'bg-purple-100 text-purple-800'; break;
                                            case 'reboot': echo 'bg-orange-100 text-orange-800'; break;
                                            default: echo 'bg-gray-100 text-gray-800';
                                        }
                                        ?>">
                                        <?= htmlspecialchars($commande['commande']) ?>
                                    </span>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span class="px-2 py-1 rounded 
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
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <?= date('d/m H:i:s', strtotime($commande['date_creation'])) ?>
                                </td>
                            </tr>
                            <?php endforeach; ?>
                            
                            <?php if (count($commandes_recentes) === 0): ?>
                            <tr>
                                <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                                    Aucune commande récente
                                </td>
                            </tr>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Présentations populaires -->
            <div class="dashboard-card bg-white rounded-lg shadow-lg p-6">
                <h2 class="text-xl font-bold text-gray-800 mb-4">
                    <i class="fas fa-star text-yellow-500"></i>
                    Présentations actives
                </h2>
                
                <div class="space-y-4">
                    <?php foreach ($presentations_populaires as $index => $presentation): ?>
                    <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div class="flex items-center">
                            <div class="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center mr-3">
                                <?= $index + 1 ?>
                            </div>
                            <div>
                                <p class="font-medium text-gray-800"><?= htmlspecialchars($presentation['nom']) ?></p>
                                <p class="text-xs text-gray-500">
                                    <?= $presentation['nombre_appareils'] ?> appareil<?= $presentation['nombre_appareils'] > 1 ? 's' : '' ?>
                                </p>
                            </div>
                        </div>
                    </div>
                    <?php endforeach; ?>
                    
                    <?php if (count($presentations_populaires) === 0): ?>
                    <div class="text-center py-4 text-gray-500">
                        <i class="fas fa-info-circle mb-2 text-xl"></i>
                        <p>Aucune présentation active</p>
                    </div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            // Données pour le graphique
            const statusData = {
                labels: ['En ligne', 'En diffusion', 'En pause', 'Hors ligne', 'Erreur'],
                datasets: [{
                    data: [
                        <?= $stats['appareils_en_ligne'] - $stats['appareils_en_diffusion'] ?>, 
                        <?= $stats['appareils_en_diffusion'] ?>, 
                        0, // Pas de données pour "En pause" dans les statistiques
                        <?= $stats['total_appareils'] - $stats['appareils_en_ligne'] ?>,
                        0  // Pas de données pour "Erreur" dans les statistiques
                    ],
                    backgroundColor: [
                        '#10b981', // Vert - En ligne
                        '#3b82f6', // Bleu - En diffusion
                        '#f59e0b', // Jaune - En pause
                        '#6b7280', // Gris - Hors ligne
                        '#ef4444'  // Rouge - Erreur
                    ],
                    borderWidth: 0
                }]
            };

            // Configuration du graphique
            const statusChart = new Chart(
                document.getElementById('status-chart'),
                {
                    type: 'doughnut',
                    data: statusData,
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    font: {
                                        size: 12
                                    }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.raw || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = Math.round((value / total) * 100);
                                        return `${label}: ${value} (${percentage}%)`;
                                    }
                                }
                            }
                        },
                        cutout: '70%'
                    }
                }
            );

            // Actualiser la page
            document.getElementById('refresh-button').addEventListener('click', function() {
                location.reload();
            });
            
            // Actualiser automatiquement toutes les 30 secondes
            setInterval(function() {
                location.reload();
            }, 30000);
        });
    </script>
</body>
</html>
<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Device-ID, X-Device-Type, X-Enrollment-Token, X-Device-Registered, X-App-Version, User-Agent');

// Gestion des requêtes OPTIONS (preflight CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

error_reporting(0);
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);

// Fonction pour générer une réponse JSON
function jsonResponse($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// Fonction pour logger les erreurs
function logError($message, $context = []) {
    $logMessage = date('Y-m-d H:i:s') . ' - ' . $message;
    if (!empty($context)) {
        $logMessage .= ' - Context: ' . json_encode($context);
    }
    error_log($logMessage);
}

// Récupérer la méthode HTTP et le chemin
$method = $_SERVER['REQUEST_METHOD'];
$path = '';
if (isset($_SERVER['PATH_INFO'])) {
    $path = $_SERVER['PATH_INFO'];
} elseif (isset($_SERVER['REQUEST_URI'])) {
    $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $basePath = dirname($_SERVER['SCRIPT_NAME']);
    $path = substr($uri, strlen($basePath));
}
$path = trim($path, '/');

// Connexion à la base de données
try {
    require_once('dbpdointranet.php');
    $dbpdointranet->exec("USE affichageDynamique");
} catch (Exception $e) {
    jsonResponse(['error' => 'Connexion à la base de données échouée: ' . $e->getMessage()], 500);
}

// Router les requêtes
switch ($path) {
    case 'appareil/heartbeat':
        if ($method === 'POST') {
            try {
                $deviceId = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
                if (empty($deviceId)) {
                    jsonResponse(['error' => 'Device ID requis'], 400);
                }

                $input = file_get_contents('php://input');
                $statusData = json_decode($input, true);

                if (json_last_error() !== JSON_ERROR_NONE) {
                    jsonResponse(['error' => 'JSON invalide'], 400);
                }

                // Mettre à jour le statut de l'appareil
                $stmt = $dbpdointranet->prepare("
                    UPDATE appareils 
                    SET 
                        derniere_connexion = NOW(),
                        statut_temps_reel = ?,
                        presentation_courante_id = ?,
                        presentation_courante_nom = ?,
                        slide_courant_index = ?,
                        total_slides = ?,
                        mode_boucle = ?,
                        lecture_automatique = ?,
                        uptime_secondes = ?,
                        utilisation_memoire = ?,
                        force_wifi = ?,
                        version_app = ?,
                        message_erreur = ?
                    WHERE identifiant_unique = ?
                ");

                $stmt->execute([
                    $statusData['status'] ?? 'online',
                    $statusData['current_presentation_id'] ?? null,
                    $statusData['current_presentation_name'] ?? null,
                    $statusData['current_slide_index'] ?? null,
                    $statusData['total_slides'] ?? null,
                    $statusData['is_looping'] ? 1 : 0,
                    $statusData['auto_play'] ? 1 : 0,
                    $statusData['uptime_seconds'] ?? null,
                    $statusData['memory_usage'] ?? null,
                    $statusData['wifi_strength'] ?? null,
                    $statusData['app_version'] ?? null,
                    $statusData['error_message'] ?? null,
                    $deviceId
                ]);

                // Insérer un log d'activité
                $stmt = $dbpdointranet->prepare("
                    INSERT INTO logs_activite 
                    (type_action, identifiant_appareil, message, details, adresse_ip)
                    VALUES ('heartbeat', ?, 'Heartbeat reçu', ?, ?)
                ");
                $stmt->execute([
                    $deviceId,
                    json_encode($statusData),
                    $_SERVER['REMOTE_ADDR'] ?? ''
                ]);

                jsonResponse(['success' => true, 'message' => 'Heartbeat reçu']);

            } catch (Exception $e) {
                logError("Erreur heartbeat", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors du traitement du heartbeat'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    case 'appareil/commandes':
        if ($method === 'GET') {
            try {
                $deviceId = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';
                if (empty($deviceId)) {
                    jsonResponse(['error' => 'Device ID requis'], 400);
                }

                // Récupérer les commandes en attente pour cet appareil
                $stmt = $dbpdointranet->prepare("
                    SELECT * FROM commandes_distantes 
                    WHERE identifiant_appareil = ? 
                    AND statut = 'en_attente'
                    ORDER BY date_creation ASC
                ");
                $stmt->execute([$deviceId]);
                $commands = $stmt->fetchAll(PDO::FETCH_ASSOC);

                jsonResponse(['commands' => $commands]);

            } catch (Exception $e) {
                logError("Erreur récupération commandes", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors de la récupération des commandes'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    case (preg_match('/^appareil\/commandes\/(\d+)\/ack$/', $path, $matches) ? true : false):
        if ($method === 'POST') {
            try {
                $commandId = $matches[1];
                $deviceId = $_SERVER['HTTP_X_DEVICE_ID'] ?? '';

                // Marquer la commande comme exécutée
                $stmt = $dbpdointranet->prepare("
                    UPDATE commandes_distantes 
                    SET statut = 'executee', date_execution = NOW()
                    WHERE id = ? AND identifiant_appareil = ?
                ");
                $stmt->execute([$commandId, $deviceId]);

                jsonResponse(['success' => true, 'message' => 'Commande confirmée']);

            } catch (Exception $e) {
                logError("Erreur confirmation commande", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors de la confirmation'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    case 'admin/appareils/statut':
        if ($method === 'GET') {
            try {
                // Récupérer le statut de tous les appareils
                $stmt = $dbpdointranet->query("
                    SELECT 
                        a.*,
                        p.nom as presentation_courante_nom_complet,
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

                // Formater les données pour l'affichage
                foreach ($appareils as &$appareil) {
                    $appareil['derniere_connexion_formatee'] = date('d/m/Y H:i:s', strtotime($appareil['derniere_connexion']));
                    $appareil['uptime_formate'] = $appareil['uptime_secondes'] ? gmdate('H:i:s', $appareil['uptime_secondes']) : null;
                    $appareil['capacites'] = json_decode($appareil['capacites'] ?? '[]', true);
                }

                jsonResponse(['appareils' => $appareils]);

            } catch (Exception $e) {
                logError("Erreur récupération statut appareils", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors de la récupération du statut'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    case 'admin/commande/envoyer':
        if ($method === 'POST') {
            try {
                $input = file_get_contents('php://input');
                $commandData = json_decode($input, true);

                if (json_last_error() !== JSON_ERROR_NONE) {
                    jsonResponse(['error' => 'JSON invalide'], 400);
                }

                // Validation des champs requis
                if (empty($commandData['device_id']) || empty($commandData['command'])) {
                    jsonResponse(['error' => 'device_id et command requis'], 400);
                }

                // Insérer la commande dans la base
                $stmt = $dbpdointranet->prepare("
                    INSERT INTO commandes_distantes 
                    (identifiant_appareil, commande, parametres, statut, date_creation)
                    VALUES (?, ?, ?, 'en_attente', NOW())
                ");
                $stmt->execute([
                    $commandData['device_id'],
                    $commandData['command'],
                    json_encode($commandData['parameters'] ?? [])
                ]);

                $commandId = $dbpdointranet->lastInsertId();

                // Log de l'action
                $stmt = $dbpdointranet->prepare("
                    INSERT INTO logs_activite 
                    (type_action, identifiant_appareil, message, details, adresse_ip)
                    VALUES ('commande_distante', ?, 'Commande envoyée', ?, ?)
                ");
                $stmt->execute([
                    $commandData['device_id'],
                    json_encode($commandData),
                    $_SERVER['REMOTE_ADDR'] ?? ''
                ]);

                jsonResponse([
                    'success' => true, 
                    'message' => 'Commande envoyée',
                    'command_id' => $commandId
                ]);

            } catch (Exception $e) {
                logError("Erreur envoi commande", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors de l\'envoi de la commande'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    case 'admin/statistiques':
        if ($method === 'GET') {
            try {
                // Statistiques générales
                $stats = [];

                // Nombre total d'appareils
                $stmt = $dbpdointranet->query("SELECT COUNT(*) as total FROM appareils");
                $stats['total_appareils'] = $stmt->fetchColumn();

                // Appareils en ligne (dernière connexion < 2 minutes)
                $stmt = $dbpdointranet->query("
                    SELECT COUNT(*) as online 
                    FROM appareils 
                    WHERE derniere_connexion > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
                ");
                $stats['appareils_en_ligne'] = $stmt->fetchColumn();

                // Appareils en cours de diffusion
                $stmt = $dbpdointranet->query("
                    SELECT COUNT(*) as playing 
                    FROM appareils 
                    WHERE statut_temps_reel = 'playing'
                ");
                $stats['appareils_en_diffusion'] = $stmt->fetchColumn();

                // Présentations actives
                $stmt = $dbpdointranet->query("
                    SELECT COUNT(DISTINCT presentation_courante_id) as active_presentations
                    FROM appareils 
                    WHERE presentation_courante_id IS NOT NULL 
                    AND statut_temps_reel = 'playing'
                ");
                $stats['presentations_actives'] = $stmt->fetchColumn();

                // Commandes en attente
                $stmt = $dbpdointranet->query("
                    SELECT COUNT(*) as pending_commands
                    FROM commandes_distantes 
                    WHERE statut = 'en_attente'
                ");
                $stats['commandes_en_attente'] = $stmt->fetchColumn();

                jsonResponse(['statistiques' => $stats]);

            } catch (Exception $e) {
                logError("Erreur récupération statistiques", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur lors de la récupération des statistiques'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    default:
        jsonResponse([
            'error' => 'Endpoint non trouvé',
            'requested_path' => $path,
            'available_endpoints' => [
                'POST /appareil/heartbeat' => 'Envoyer le statut de l\'appareil',
                'GET /appareil/commandes' => 'Récupérer les commandes en attente',
                'POST /appareil/commandes/{id}/ack' => 'Confirmer l\'exécution d\'une commande',
                'GET /admin/appareils/statut' => 'Statut de tous les appareils',
                'POST /admin/commande/envoyer' => 'Envoyer une commande à un appareil',
                'GET /admin/statistiques' => 'Statistiques générales'
            ]
        ], 404);
}
?>
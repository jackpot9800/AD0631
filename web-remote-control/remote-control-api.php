<?php
// remote-control-api.php - API pour le contrôle à distance des appareils

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

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

// Récupérer les données de la requête
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    jsonResponse(['success' => false, 'message' => 'JSON invalide dans le corps de la requête'], 400);
}

// Vérifier l'action demandée
$action = $data['action'] ?? '';
$device_id = $data['device_id'] ?? '';

if (empty($device_id)) {
    jsonResponse(['success' => false, 'message' => 'ID appareil requis'], 400);
}

// Connexion à la base de données
try {
    require_once('dbpdointranet.php');
    $dbpdointranet->exec("USE affichageDynamique");
} catch (Exception $e) {
    logError('Connexion à la base de données échouée', ['error' => $e->getMessage()]);
    jsonResponse(['success' => false, 'message' => 'Erreur de connexion à la base de données'], 500);
}

// Vérifier que l'appareil existe
$stmt = $dbpdointranet->prepare("SELECT id FROM appareils WHERE identifiant_unique = ?");
$stmt->execute([$device_id]);
$appareil = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$appareil) {
    jsonResponse(['success' => false, 'message' => 'Appareil non trouvé'], 404);
}

// Traiter l'action demandée
switch ($action) {
    case 'send_command':
        // Envoyer une commande à l'appareil
        $command = $data['command'] ?? '';
        $parameters = $data['parameters'] ?? [];
        
        if (empty($command)) {
            jsonResponse(['success' => false, 'message' => 'Commande requise'], 400);
        }
        
        // Valider la commande
        $valid_commands = ['play', 'pause', 'stop', 'restart', 'next_slide', 'prev_slide', 'goto_slide', 'assign_presentation', 'reboot', 'update_app'];
        if (!in_array($command, $valid_commands)) {
            jsonResponse(['success' => false, 'message' => 'Commande invalide'], 400);
        }
        
        // Validation spécifique pour certaines commandes
        if ($command === 'goto_slide' && !isset($parameters['slide_index'])) {
            jsonResponse(['success' => false, 'message' => 'Index de slide requis'], 400);
        }
        
        if ($command === 'assign_presentation' && !isset($parameters['presentation_id'])) {
            jsonResponse(['success' => false, 'message' => 'ID de présentation requis'], 400);
        }
        
        try {
            // Insérer la commande dans la base de données
            $stmt = $dbpdointranet->prepare("
                INSERT INTO commandes_distantes 
                (identifiant_appareil, commande, parametres, statut, date_creation)
                VALUES (?, ?, ?, 'en_attente', NOW())
            ");
            
            $stmt->execute([
                $device_id,
                $command,
                json_encode($parameters)
            ]);
            
            $command_id = $dbpdointranet->lastInsertId();
            
            // Enregistrer un log d'activité
            $stmt = $dbpdointranet->prepare("
                INSERT INTO logs_activite 
                (type_action, appareil_id, identifiant_appareil, message, details, adresse_ip, user_agent)
                VALUES ('commande_distante', ?, ?, ?, ?, ?, ?)
            ");
            
            $stmt->execute([
                $appareil['id'],
                $device_id,
                "Commande distante envoyée: {$command}",
                json_encode([
                    'command' => $command,
                    'parameters' => $parameters,
                    'command_id' => $command_id
                ]),
                $_SERVER['REMOTE_ADDR'] ?? '',
                $_SERVER['HTTP_USER_AGENT'] ?? ''
            ]);
            
            jsonResponse([
                'success' => true, 
                'message' => 'Commande envoyée avec succès',
                'command_id' => $command_id
            ]);
            
        } catch (Exception $e) {
            logError('Erreur lors de l\'envoi de la commande', ['error' => $e->getMessage()]);
            jsonResponse(['success' => false, 'message' => 'Erreur lors de l\'envoi de la commande'], 500);
        }
        break;
        
    case 'get_status':
        // Récupérer le statut de l'appareil
        try {
            $stmt = $dbpdointranet->prepare("
                SELECT 
                    a.*,
                    p.nom as presentation_courante_nom
                FROM appareils a
                LEFT JOIN presentations p ON a.presentation_courante_id = p.id
                WHERE a.identifiant_unique = ?
            ");
            $stmt->execute([$device_id]);
            $appareil = $stmt->fetch(PDO::FETCH_ASSOC);
            
            if (!$appareil) {
                jsonResponse(['success' => false, 'message' => 'Appareil non trouvé'], 404);
            }
            
            // Déterminer le statut de connexion
            if ($appareil['derniere_connexion']) {
                $last_seen = new DateTime($appareil['derniere_connexion']);
                $now = new DateTime();
                $diff = $now->getTimestamp() - $last_seen->getTimestamp();
                
                // Si pas de mise à jour depuis plus de 2 minutes, considérer comme hors ligne
                if ($diff > 120 && $appareil['statut_temps_reel'] !== 'offline') {
                    $appareil['statut_temps_reel'] = 'offline';
                    
                    // Mettre à jour le statut dans la base de données
                    $stmt = $dbpdointranet->prepare("
                        UPDATE appareils 
                        SET statut_temps_reel = 'offline' 
                        WHERE identifiant_unique = ?
                    ");
                    $stmt->execute([$device_id]);
                }
            }
            
            jsonResponse([
                'success' => true,
                'data' => $appareil
            ]);
            
        } catch (Exception $e) {
            logError('Erreur lors de la récupération du statut', ['error' => $e->getMessage()]);
            jsonResponse(['success' => false, 'message' => 'Erreur lors de la récupération du statut'], 500);
        }
        break;
        
    case 'get_command_history':
        // Récupérer l'historique des commandes
        try {
            $stmt = $dbpdointranet->prepare("
                SELECT * FROM commandes_distantes 
                WHERE identifiant_appareil = ? 
                ORDER BY date_creation DESC 
                LIMIT 10
            ");
            $stmt->execute([$device_id]);
            $commandes = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            jsonResponse([
                'success' => true,
                'data' => $commandes
            ]);
            
        } catch (Exception $e) {
            logError('Erreur lors de la récupération de l\'historique', ['error' => $e->getMessage()]);
            jsonResponse(['success' => false, 'message' => 'Erreur lors de la récupération de l\'historique'], 500);
        }
        break;
        
    case 'assign_presentation':
        // Assigner une présentation à l'appareil
        $presentation_id = $data['presentation_id'] ?? 0;
        $auto_play = $data['auto_play'] ?? true;
        $loop_mode = $data['loop_mode'] ?? true;
        
        if (empty($presentation_id)) {
            jsonResponse(['success' => false, 'message' => 'ID de présentation requis'], 400);
        }
        
        try {
            // Vérifier que la présentation existe
            $stmt = $dbpdointranet->prepare("SELECT id FROM presentations WHERE id = ?");
            $stmt->execute([$presentation_id]);
            if (!$stmt->fetch()) {
                jsonResponse(['success' => false, 'message' => 'Présentation non trouvée'], 404);
            }
            
            // Créer une diffusion pour cet appareil
            $stmt = $dbpdointranet->prepare("
                INSERT INTO diffusions 
                (presentation_id, appareil_id, identifiant_appareil, lecture_automatique, mode_boucle, statut, priorite, date_creation)
                VALUES (?, ?, ?, ?, ?, 'active', 2, NOW())
                ON DUPLICATE KEY UPDATE
                    presentation_id = VALUES(presentation_id),
                    lecture_automatique = VALUES(lecture_automatique),
                    mode_boucle = VALUES(mode_boucle),
                    statut = 'active',
                    date_creation = NOW()
            ");
            
            $stmt->execute([
                $presentation_id,
                $appareil['id'],
                $device_id,
                $auto_play ? 1 : 0,
                $loop_mode ? 1 : 0
            ]);
            
            // Envoyer une commande pour lancer la présentation
            $stmt = $dbpdointranet->prepare("
                INSERT INTO commandes_distantes 
                (identifiant_appareil, commande, parametres, statut, date_creation)
                VALUES (?, 'assign_presentation', ?, 'en_attente', NOW())
            ");
            
            $parameters = json_encode([
                'presentation_id' => (int)$presentation_id,
                'auto_play' => (bool)$auto_play,
                'loop_mode' => (bool)$loop_mode
            ]);
            
            $stmt->execute([$device_id, $parameters]);
            
            jsonResponse([
                'success' => true,
                'message' => 'Présentation assignée et commande envoyée'
            ]);
            
        } catch (Exception $e) {
            logError('Erreur lors de l\'assignation de la présentation', ['error' => $e->getMessage()]);
            jsonResponse(['success' => false, 'message' => 'Erreur lors de l\'assignation de la présentation'], 500);
        }
        break;
        
    default:
        jsonResponse(['success' => false, 'message' => 'Action non reconnue'], 400);
}
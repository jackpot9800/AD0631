<?php
// Désactiver complètement l'affichage des erreurs pour l'API
error_reporting(0);
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
ini_set('log_errors', 1);

// Headers CORS améliorés
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Device-ID, X-Device-Type, X-Enrollment-Token, X-Device-Registered, X-App-Version, User-Agent');

// Gestion des requêtes OPTIONS (preflight CORS)
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Fonction pour générer une réponse JSON propre
function jsonResponse($data, $status = 200) {
    // S'assurer qu'aucune sortie n'a été envoyée avant
    if (ob_get_level()) {
        ob_clean();
    }
    
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// Fonction pour logger les erreurs sans les afficher
function logError($message, $context = []) {
    $logMessage = date('Y-m-d H:i:s') . ' - ' . $message;
    if (!empty($context)) {
        $logMessage .= ' - Context: ' . json_encode($context);
    }
    error_log($logMessage);
}

// Récupérer la méthode HTTP et le chemin
$method = $_SERVER['REQUEST_METHOD'];

// Récupérer le chemin de la requête de manière plus robuste
$path = '';
if (isset($_SERVER['PATH_INFO'])) {
    $path = $_SERVER['PATH_INFO'];
} elseif (isset($_SERVER['REQUEST_URI'])) {
    $uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $scriptName = $_SERVER['SCRIPT_NAME'];
    $basePath = dirname($scriptName);
    
    // Gérer le cas où le script est dans un sous-dossier
    if ($basePath !== '/') {
        $path = substr($uri, strlen($basePath));
    } else {
        $path = $uri;
    }
    
    // Enlever le nom du script si présent
    $scriptBasename = basename($scriptName);
    if (strpos($path, $scriptBasename) === 1) {
        $path = substr($path, strlen($scriptBasename) + 1);
    }
}

$path = trim($path, '/');

// Log pour debug (sera dans les logs du serveur, pas affiché)
logError("API Request", [
    'method' => $method,
    'path' => $path,
    'uri' => $_SERVER['REQUEST_URI'] ?? '',
    'script_name' => $_SERVER['SCRIPT_NAME'] ?? '',
    'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
    'device_id' => $_SERVER['HTTP_X_DEVICE_ID'] ?? ''
]);

// Si pas de chemin, retourner les informations de base
if (empty($path)) {
    jsonResponse([
        'status' => 'API is running',
        'version' => '2.0',
        'timestamp' => date('c'),
        'endpoints' => [
            'GET /version' => 'Get API version',
            'GET /presentations' => 'List all presentations',
            'GET /presentation/{id}' => 'Get presentation details',
            'POST /device/register' => 'Register a device',
            'GET /device/assigned-presentation' => 'Get assigned presentation for device',
            'GET /device/default-presentation' => 'Get default presentation for device'
        ]
    ]);
}

// Connexion à la base de données
try {
    require_once('dbpdointranet.php');
    
    // Vérifier si la connexion a réussi
    if (!$dbpdointranet) {
        throw new Exception("Connexion à la base de données échouée");
    }
    
    // Pas besoin de sélectionner la base de données car déjà fait dans dbpdointranet.php
} catch (Exception $e) {
    logError("Database connection failed", ['error' => $e->getMessage()]);
    jsonResponse(['error' => 'Connexion à la base de données échouée: ' . $e->getMessage()], 500);
}

// Router les requêtes
switch ($path) {
    case 'version':
        jsonResponse([
            'version' => '2.0',
            'api_status' => 'running',
            'database' => 'affichageDynamique',
            'timestamp' => date('c'),
            'php_version' => PHP_VERSION,
            'features' => [
                'presentations_avancees',
                'gestion_appareils',
                'diffusions_programmees',
                'presentations_defaut',
                'lecture_automatique',
                'mode_boucle',
                'logs_activite',
                'debug_complet'
            ]
        ]);
        break;
        
    case 'presentations':
        if ($method === 'GET') {
            try {
                $stmt = $dbpdointranet->query("
                    SELECT 
                        p.*,
                        COUNT(pm.media_id) as slide_count,
                        SUM(pm.duree_affichage) as duree_totale_calculee
                    FROM presentations p
                    LEFT JOIN presentation_medias pm ON p.id = pm.presentation_id
                    WHERE p.statut = 'actif'
                    GROUP BY p.id
                    ORDER BY p.date_creation DESC
                ");
                $presentations = $stmt->fetchAll(PDO::FETCH_ASSOC);
                
                // Nettoyer et valider les données
                foreach ($presentations as &$pres) {
                    $pres['slide_count'] = (int)($pres['slide_count'] ?? 0);
                    $pres['duree_totale'] = (int)($pres['duree_totale_calculee'] ?? 0);
                    
                    // Support pour les deux APIs - mapping des noms de colonnes
                    $pres['name'] = $pres['nom'] ?? $pres['name'] ?? 'Présentation sans nom';
                    $pres['created_at'] = $pres['date_creation'] ?? $pres['created_at'] ?? date('c');
                    
                    if (empty($pres['description'])) {
                        $pres['description'] = 'Aucune description disponible';
                    }
                    
                    // Générer l'URL de prévisualisation
                    $pres['preview_url'] = sprintf(
                        'http://%s/mods/livetv/chromecast_display.php?presentation=%d&key=android_%s',
                        $_SERVER['HTTP_HOST'],
                        $pres['id'],
                        uniqid()
                    );
                    
                    // Nettoyer les champs non nécessaires
                    unset($pres['duree_totale_calculee']);
                }
                
                logError("Presentations fetched", ['count' => count($presentations)]);
                jsonResponse(['presentations' => $presentations]);
                
            } catch (PDOException $e) {
                logError("Database error in presentations", ['error' => $e->getMessage()]);
                jsonResponse(['error' => 'Erreur base de données lors de la récupération des présentations'], 500);
            }
        } else {
            jsonResponse(['error' => 'Méthode non autorisée'], 405);
        }
        break;

    // Ajoutez ici les autres endpoints selon vos besoins...
    
    default:
        // Vérifier si c'est une requête de présentation spécifique
        if (preg_match('/^presentation\/(\d+)$/', $path, $matches)) {
            if ($method === 'GET') {
                $presentationId = (int)$matches[1];
                
                try {
                    // Récupérer les informations de la présentation
                    $stmt = $dbpdointranet->prepare("
                        SELECT 
                            p.*,
                            COUNT(pm.media_id) as slide_count
                        FROM presentations p
                        LEFT JOIN presentation_medias pm ON p.id = pm.presentation_id
                        WHERE p.id = ? AND p.statut = 'actif'
                        GROUP BY p.id
                    ");
                    $stmt->execute([$presentationId]);
                    $presentation = $stmt->fetch(PDO::FETCH_ASSOC);
                    
                    if (!$presentation) {
                        logError("Presentation not found", ['id' => $presentationId]);
                        jsonResponse(['error' => 'Présentation non trouvée'], 404);
                    }
                    
                    // Récupérer les médias avec leurs durées
                    $stmt = $dbpdointranet->prepare("
                        SELECT 
                            m.id,
                            m.nom as name,
                            m.titre as title,
                            m.type_media,
                            m.chemin_fichier as image_path,
                            m.chemin_fichier as media_path,
                            pm.duree_affichage as duration,
                            pm.effet_transition as transition_type,
                            pm.ordre_affichage as position,
                            m.date_creation as created_at
                        FROM presentation_medias pm
                        JOIN medias m ON pm.media_id = m.id
                        WHERE pm.presentation_id = ? AND m.statut = 'actif'
                        ORDER BY pm.ordre_affichage ASC, m.id ASC
                    ");
                    $stmt->execute([$presentationId]);
                    $slides = $stmt->fetchAll(PDO::FETCH_ASSOC);
                    
                    // Traiter les slides
                    $validSlides = [];
                    foreach ($slides as $slide) {
                        $imagePath = $slide['media_path'] ?? $slide['image_path'] ?? '';
                        
                        // Construire l'URL de l'image
                        if (!empty($imagePath)) {
                            $slide['image_url'] = sprintf(
                                'http://%s/mods/livetv/%s',
                                $_SERVER['HTTP_HOST'],
                                $imagePath
                            );
                        } else {
                            $slide['image_url'] = sprintf(
                                'http://%s/mods/livetv/assets/placeholder.jpg',
                                $_SERVER['HTTP_HOST']
                            );
                        }
                        
                        // Valider la durée
                        $duration = (int)($slide['duration'] ?? 5);
                        if ($duration < 1) $duration = 5;
                        if ($duration > 300) $duration = 300;
                        
                        $processedSlide = [
                            'id' => (int)$slide['id'],
                            'name' => $slide['name'] ?? $slide['title'] ?? "Slide {$slide['id']}",
                            'title' => $slide['title'] ?? $slide['name'] ?? "Slide {$slide['id']}",
                            'image_path' => $imagePath,
                            'media_path' => $slide['media_path'] ?? $imagePath,
                            'image_url' => $slide['image_url'],
                            'duration' => $duration,
                            'transition_type' => $slide['transition_type'] ?? 'fade',
                            'position' => (int)($slide['position'] ?? 0),
                            'created_at' => $slide['created_at']
                        ];
                        
                        $validSlides[] = $processedSlide;
                    }
                    
                    // Préparer la réponse
                    $presentation['slide_count'] = count($validSlides);
                    $presentation['slides'] = $validSlides;
                    $presentation['description'] = $presentation['description'] ?? 'Aucune description disponible';
                    
                    // Convertir les noms de colonnes pour compatibilité
                    $presentation['name'] = $presentation['nom'] ?? $presentation['name'] ?? 'Présentation';
                    $presentation['created_at'] = $presentation['date_creation'] ?? $presentation['created_at'] ?? date('c');
                    
                    // Générer l'URL de prévisualisation
                    $presentation['preview_url'] = sprintf(
                        'http://%s/mods/livetv/chromecast_display.php?presentation=%d&key=android_%s',
                        $_SERVER['HTTP_HOST'],
                        $presentation['id'],
                        uniqid()
                    );
                    
                    logError("Presentation fetched", [
                        'id' => $presentationId,
                        'name' => $presentation['name'],
                        'slides_count' => count($validSlides)
                    ]);
                    
                    jsonResponse(['presentation' => $presentation]);
                    
                } catch (PDOException $e) {
                    logError("Database error in presentation fetch", [
                        'id' => $presentationId,
                        'error' => $e->getMessage()
                    ]);
                    jsonResponse(['error' => 'Erreur base de données'], 500);
                }
            } else {
                jsonResponse(['error' => 'Méthode non autorisée'], 405);
            }
        }
        else {
            // Endpoint non trouvé
            jsonResponse([
                'error' => 'Endpoint non trouvé',
                'requested_path' => $path,
                'method' => $method,
                'available_endpoints' => [
                    'GET /' => 'Informations API',
                    'GET /version' => 'Version API',
                    'GET /presentations' => 'Liste des présentations',
                    'GET /presentation/{id}' => 'Détails présentation'
                ]
            ], 404);
        }
}
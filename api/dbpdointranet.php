<?php
// dbpdointranet.php - Fichier de connexion à la base de données

// Paramètres de connexion à la base de données
$db_host = 'localhost';  // Adresse du serveur MySQL
$db_user = 'root';       // Nom d'utilisateur MySQL
$db_pass = '';           // Mot de passe MySQL
$db_name = 'affichageDynamique'; // Nom de la base de données

try {
    // Créer une connexion PDO
    $dbpdointranet = new PDO(
        "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
        $db_user,
        $db_pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"
        ]
    );
    
    // Log de connexion réussie (pour debug)
    error_log("Connexion à la base de données réussie: $db_host / $db_name");
} catch (PDOException $e) {
    // En cas d'erreur, logger l'erreur mais ne pas l'afficher
    error_log("Erreur de connexion à la base de données: " . $e->getMessage());
    
    // Créer quand même l'objet pour éviter les erreurs fatales
    $dbpdointranet = null;
}
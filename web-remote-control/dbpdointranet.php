<?php
// dbpdointranet.php - Connexion à la base de données

// Paramètres de connexion à la base de données
$db_host = 'localhost';
$db_name = 'affichageDynamique';
$db_user = 'root';
$db_pass = '';

try {
    // Créer une connexion PDO
    $dbpdointranet = new PDO(
        "mysql:host=$db_host;charset=utf8mb4",
        $db_user,
        $db_pass,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"
        ]
    );
} catch (PDOException $e) {
    // En cas d'erreur, afficher un message et arrêter le script
    die('Erreur de connexion à la base de données : ' . $e->getMessage());
}
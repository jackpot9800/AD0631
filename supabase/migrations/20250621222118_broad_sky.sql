-- Script 11: Ajout des tables pour le statut temps réel et contrôle à distance
-- Exécutez ce script dans HeidiSQL après les autres scripts

USE affichageDynamique;

-- Ajouter des colonnes de statut temps réel à la table appareils
ALTER TABLE appareils 
ADD COLUMN IF NOT EXISTS statut_temps_reel ENUM('online', 'offline', 'playing', 'paused', 'error') DEFAULT 'offline',
ADD COLUMN IF NOT EXISTS presentation_courante_id INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS presentation_courante_nom VARCHAR(255) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS slide_courant_index INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_slides INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS mode_boucle TINYINT(1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS lecture_automatique TINYINT(1) DEFAULT 0,
ADD COLUMN IF NOT EXISTS uptime_secondes INT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS utilisation_memoire INT DEFAULT NULL COMMENT 'Pourcentage d\'utilisation mémoire',
ADD COLUMN IF NOT EXISTS force_wifi INT DEFAULT NULL COMMENT 'Force du signal WiFi en pourcentage',
ADD COLUMN IF NOT EXISTS message_erreur TEXT DEFAULT NULL;

-- Table des commandes à distance
CREATE TABLE IF NOT EXISTS commandes_distantes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    identifiant_appareil VARCHAR(255) NOT NULL,
    commande ENUM('play', 'pause', 'stop', 'restart', 'next_slide', 'prev_slide', 'goto_slide', 'assign_presentation', 'reboot', 'update_app') NOT NULL,
    parametres JSON DEFAULT NULL COMMENT 'Paramètres de la commande (slide_index, presentation_id, etc.)',
    statut ENUM('en_attente', 'executee', 'echouee', 'expiree') DEFAULT 'en_attente',
    date_creation TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_execution TIMESTAMP NULL DEFAULT NULL,
    date_expiration TIMESTAMP NULL DEFAULT NULL,
    resultat_execution TEXT DEFAULT NULL,
    
    -- Index pour améliorer les performances
    INDEX idx_commandes_appareil (identifiant_appareil),
    INDEX idx_commandes_statut (statut),
    INDEX idx_commandes_date_creation (date_creation),
    INDEX idx_commandes_en_attente (identifiant_appareil, statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des sessions de diffusion (pour tracking détaillé)
CREATE TABLE IF NOT EXISTS sessions_diffusion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appareil_id INT NOT NULL,
    identifiant_appareil VARCHAR(255) NOT NULL,
    presentation_id INT NOT NULL,
    date_debut TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    date_fin TIMESTAMP NULL DEFAULT NULL,
    duree_totale_secondes INT DEFAULT NULL,
    slides_vues INT DEFAULT 0,
    boucles_completees INT DEFAULT 0,
    interruptions INT DEFAULT 0,
    statut_final ENUM('complete', 'interrompue', 'erreur') DEFAULT 'complete',
    
    -- Clés étrangères
    FOREIGN KEY (appareil_id) REFERENCES appareils(id) ON DELETE CASCADE,
    FOREIGN KEY (presentation_id) REFERENCES presentations(id) ON DELETE CASCADE,
    
    -- Index pour améliorer les performances
    INDEX idx_sessions_appareil (appareil_id),
    INDEX idx_sessions_presentation (presentation_id),
    INDEX idx_sessions_date_debut (date_debut),
    INDEX idx_sessions_statut (statut_final)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des métriques de performance
CREATE TABLE IF NOT EXISTS metriques_performance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appareil_id INT NOT NULL,
    identifiant_appareil VARCHAR(255) NOT NULL,
    date_mesure TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    utilisation_cpu DECIMAL(5,2) DEFAULT NULL COMMENT 'Pourcentage d\'utilisation CPU',
    utilisation_memoire DECIMAL(5,2) DEFAULT NULL COMMENT 'Pourcentage d\'utilisation mémoire',
    utilisation_stockage DECIMAL(5,2) DEFAULT NULL COMMENT 'Pourcentage d\'utilisation stockage',
    force_wifi INT DEFAULT NULL COMMENT 'Force du signal WiFi (0-100)',
    temperature_cpu DECIMAL(5,2) DEFAULT NULL COMMENT 'Température CPU en Celsius',
    fps_moyen DECIMAL(5,2) DEFAULT NULL COMMENT 'FPS moyen de l\'affichage',
    latence_reseau INT DEFAULT NULL COMMENT 'Latence réseau en ms',
    
    -- Clé étrangère
    FOREIGN KEY (appareil_id) REFERENCES appareils(id) ON DELETE CASCADE,
    
    -- Index pour améliorer les performances
    INDEX idx_metriques_appareil (appareil_id),
    INDEX idx_metriques_date (date_mesure),
    INDEX idx_metriques_appareil_date (appareil_id, date_mesure)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ajouter des index supplémentaires pour les nouvelles colonnes
CREATE INDEX IF NOT EXISTS idx_appareils_statut_temps_reel ON appareils(statut_temps_reel);
CREATE INDEX IF NOT EXISTS idx_appareils_presentation_courante ON appareils(presentation_courante_id);
CREATE INDEX IF NOT EXISTS idx_appareils_derniere_connexion ON appareils(derniere_connexion);

-- Procédure stockée pour nettoyer les anciennes commandes
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS CleanupOldCommands()
BEGIN
    -- Supprimer les commandes exécutées de plus de 7 jours
    DELETE FROM commandes_distantes 
    WHERE statut IN ('executee', 'echouee') 
    AND date_creation < DATE_SUB(NOW(), INTERVAL 7 DAY);
    
    -- Marquer comme expirées les commandes en attente de plus de 1 heure
    UPDATE commandes_distantes 
    SET statut = 'expiree', date_expiration = NOW()
    WHERE statut = 'en_attente' 
    AND date_creation < DATE_SUB(NOW(), INTERVAL 1 HOUR);
    
    -- Supprimer les anciennes métriques (garder seulement 30 jours)
    DELETE FROM metriques_performance 
    WHERE date_mesure < DATE_SUB(NOW(), INTERVAL 30 DAY);
END //
DELIMITER ;

-- Événement pour nettoyer automatiquement les anciennes données
CREATE EVENT IF NOT EXISTS cleanup_old_data
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
  CALL CleanupOldCommands();

-- Afficher confirmation
SELECT 'Tables de statut temps réel et contrôle à distance créées avec succès!' as message;

-- Vérifier les nouvelles colonnes
DESCRIBE appareils;
DESCRIBE commandes_distantes;
DESCRIBE sessions_diffusion;
DESCRIBE metriques_performance;
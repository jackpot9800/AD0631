# Interface de contrôle à distance pour Fire TV

Cette interface web permet de contrôler à distance les appareils Fire TV exécutant l'application Presentation Kiosk.

## 🚀 Fonctionnalités

- **Tableau de bord** : Vue d'ensemble de tous les appareils et leur statut
- **Liste des appareils** : Affichage détaillé de tous les appareils enregistrés
- **Contrôle à distance** : Interface complète pour contrôler un appareil spécifique
- **Commandes en temps réel** : Lecture, pause, arrêt, navigation entre slides
- **Assignation de présentations** : Assigner et lancer des présentations à distance
- **Surveillance du statut** : Voir l'état actuel de chaque appareil en temps réel
- **Historique des commandes** : Suivi des commandes envoyées et leur statut

## 📋 Structure des fichiers

- `dashboard.php` : Tableau de bord principal avec statistiques
- `device-list.php` : Liste de tous les appareils enregistrés
- `device-control.php` : Interface de contrôle pour un appareil spécifique
- `remote-control-api.php` : API pour envoyer des commandes et récupérer le statut

## 🔧 Installation

1. Placez ces fichiers dans votre dossier web (ex: `/var/www/html/mods/livetv/remote-control/`)
2. Assurez-vous que le fichier `dbpdointranet.php` est accessible (connexion à la base de données)
3. Vérifiez que la base de données `affichageDynamique` est configurée correctement

## 🔌 Intégration

Pour intégrer le contrôle à distance dans votre page de détail des appareils existante :

### Option 1 : Iframe

```html
<iframe src="remote-control/device-control.php?device_id=DEVICE_ID" 
        style="width: 100%; height: 800px; border: none;"></iframe>
```

### Option 2 : Inclusion PHP

```php
<?php include('remote-control/device-control.php'); ?>
```

### Option 3 : Intégration AJAX

```javascript
// Charger le contenu via AJAX
$.get('remote-control/device-control.php?device_id=DEVICE_ID', function(data) {
    $('#remote-control-container').html(data);
});
```

## 📱 Adaptation à votre interface

Pour adapter cette interface à votre design existant :

1. Modifiez les classes CSS pour correspondre à votre framework (Tailwind, Bootstrap, etc.)
2. Ajustez les couleurs et le style dans les balises `<style>` de chaque fichier
3. Personnalisez les icônes selon vos besoins (FontAwesome est utilisé par défaut)

## 🔒 Sécurité

- Ajoutez une authentification à ces pages si ce n'est pas déjà fait
- Limitez l'accès aux utilisateurs autorisés
- Considérez l'ajout de tokens CSRF pour les formulaires

## 📊 Base de données

Cette interface utilise les tables suivantes de la base `affichageDynamique` :

- `appareils` : Informations sur les appareils Fire TV
- `commandes_distantes` : Commandes envoyées aux appareils
- `presentations` : Liste des présentations disponibles
- `logs_activite` : Logs des actions effectuées

## 🚀 Utilisation

1. Accédez au tableau de bord via `dashboard.php`
2. Consultez la liste des appareils via `device-list.php`
3. Contrôlez un appareil spécifique via `device-control.php?device_id=XXX`

## 🔄 Commandes disponibles

- `play` : Démarrer/reprendre la lecture
- `pause` : Mettre en pause
- `stop` : Arrêter et revenir à l'accueil
- `restart` : Redémarrer la présentation
- `next_slide` : Slide suivante
- `prev_slide` : Slide précédente
- `goto_slide` : Aller à une slide spécifique
- `assign_presentation` : Assigner et lancer une présentation
- `reboot` : Redémarrer l'appareil
- `update_app` : Mettre à jour l'application

## 📝 Personnalisation avancée

Pour ajouter de nouvelles fonctionnalités :

1. Modifiez `remote-control-api.php` pour ajouter de nouvelles actions
2. Ajoutez les boutons correspondants dans `device-control.php`
3. Mettez à jour l'application Fire TV pour gérer ces nouvelles commandes
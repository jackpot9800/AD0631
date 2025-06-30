# Documentation API de contrôle à distance

Cette API permet de contrôler à distance les appareils Fire TV exécutant l'application Presentation Kiosk.

## 🔌 Point d'entrée

```
POST /remote-control-api.php
```

## 📝 Format des requêtes

Toutes les requêtes doivent être envoyées en POST avec un corps JSON contenant les paramètres suivants :

```json
{
  "action": "nom_de_l_action",
  "device_id": "identifiant_unique_appareil",
  "command": "nom_de_la_commande",
  "parameters": {
    "param1": "valeur1",
    "param2": "valeur2"
  }
}
```

## 🔑 Actions disponibles

### 1. Envoyer une commande (`send_command`)

Envoie une commande à un appareil spécifique.

**Paramètres requis :**
- `device_id` : Identifiant unique de l'appareil
- `command` : Nom de la commande à envoyer
- `parameters` : (Optionnel) Paramètres supplémentaires pour la commande

**Commandes disponibles :**
- `play` : Démarrer/reprendre la lecture
- `pause` : Mettre en pause
- `stop` : Arrêter et revenir à l'accueil
- `restart` : Redémarrer la présentation
- `next_slide` : Slide suivante
- `prev_slide` : Slide précédente
- `goto_slide` : Aller à une slide spécifique (requiert `parameters.slide_index`)
- `assign_presentation` : Assigner et lancer une présentation (requiert `parameters.presentation_id`)
- `reboot` : Redémarrer l'appareil
- `update_app` : Mettre à jour l'application

**Exemple de requête :**
```json
{
  "action": "send_command",
  "device_id": "firetv_abc123",
  "command": "play"
}
```

**Exemple de réponse :**
```json
{
  "success": true,
  "message": "Commande envoyée avec succès",
  "command_id": 123
}
```

### 2. Récupérer le statut (`get_status`)

Récupère le statut actuel d'un appareil.

**Paramètres requis :**
- `device_id` : Identifiant unique de l'appareil

**Exemple de requête :**
```json
{
  "action": "get_status",
  "device_id": "firetv_abc123"
}
```

**Exemple de réponse :**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "nom": "Fire TV Salon",
    "identifiant_unique": "firetv_abc123",
    "statut_temps_reel": "playing",
    "presentation_courante_id": 5,
    "presentation_courante_nom": "Présentation Produits 2025",
    "slide_courant_index": 2,
    "total_slides": 10,
    "mode_boucle": 1,
    "lecture_automatique": 1,
    "derniere_connexion": "2025-06-21 15:30:45",
    "utilisation_memoire": 45,
    "force_wifi": 87
  }
}
```

### 3. Récupérer l'historique des commandes (`get_command_history`)

Récupère l'historique des commandes envoyées à un appareil.

**Paramètres requis :**
- `device_id` : Identifiant unique de l'appareil

**Exemple de requête :**
```json
{
  "action": "get_command_history",
  "device_id": "firetv_abc123"
}
```

**Exemple de réponse :**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "identifiant_appareil": "firetv_abc123",
      "commande": "play",
      "parametres": null,
      "statut": "executee",
      "date_creation": "2025-06-21 15:30:45",
      "date_execution": "2025-06-21 15:30:48"
    },
    {
      "id": 122,
      "identifiant_appareil": "firetv_abc123",
      "commande": "assign_presentation",
      "parametres": "{\"presentation_id\":5,\"auto_play\":true,\"loop_mode\":true}",
      "statut": "executee",
      "date_creation": "2025-06-21 15:25:12",
      "date_execution": "2025-06-21 15:25:15"
    }
  ]
}
```

### 4. Assigner une présentation (`assign_presentation`)

Assigne une présentation à un appareil et envoie une commande pour la lancer.

**Paramètres requis :**
- `device_id` : Identifiant unique de l'appareil
- `presentation_id` : ID de la présentation à assigner
- `auto_play` : (Optionnel) Lecture automatique (true/false)
- `loop_mode` : (Optionnel) Mode boucle (true/false)

**Exemple de requête :**
```json
{
  "action": "assign_presentation",
  "device_id": "firetv_abc123",
  "presentation_id": 5,
  "auto_play": true,
  "loop_mode": true
}
```

**Exemple de réponse :**
```json
{
  "success": true,
  "message": "Présentation assignée et commande envoyée"
}
```

## 🔄 Codes de statut

- `200 OK` : Requête traitée avec succès
- `400 Bad Request` : Paramètres manquants ou invalides
- `404 Not Found` : Appareil ou ressource non trouvé
- `500 Internal Server Error` : Erreur serveur

## 🔒 Sécurité

Cette API ne dispose pas d'authentification intégrée. Il est fortement recommandé de :

1. Ajouter une authentification (JWT, API key, etc.)
2. Limiter l'accès à cette API aux utilisateurs autorisés
3. Implémenter une protection CSRF pour les formulaires web

## 🔄 Intégration avec d'autres systèmes

Pour intégrer cette API avec d'autres systèmes, vous pouvez utiliser n'importe quel client HTTP capable d'envoyer des requêtes POST avec un corps JSON.

**Exemple avec JavaScript (fetch) :**
```javascript
async function sendCommand(deviceId, command, parameters = {}) {
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
  
  return await response.json();
}

// Exemple d'utilisation
sendCommand('firetv_abc123', 'play')
  .then(result => console.log(result))
  .catch(error => console.error(error));
```

**Exemple avec PHP (cURL) :**
```php
function sendCommand($deviceId, $command, $parameters = []) {
  $data = [
    'action' => 'send_command',
    'device_id' => $deviceId,
    'command' => $command,
    'parameters' => $parameters
  ];
  
  $ch = curl_init('remote-control-api.php');
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
  curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
  
  $response = curl_exec($ch);
  curl_close($ch);
  
  return json_decode($response, true);
}

// Exemple d'utilisation
$result = sendCommand('firetv_abc123', 'play');
print_r($result);
```
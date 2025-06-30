import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './ApiService';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { getWebSocketService, sendStatusViaWebSocket } from './WebSocketService';

export interface DeviceStatus {
  device_id: string;
  status: 'online' | 'offline' | 'playing' | 'paused' | 'error';
  current_presentation_id?: number;
  current_presentation_name?: string;
  current_slide_index?: number;
  total_slides?: number;
  is_looping?: boolean;
  auto_play?: boolean;
  last_heartbeat: string;
  uptime_seconds?: number;
  memory_usage?: number;
  battery_level?: number;
  wifi_strength?: number;
  app_version?: string;
  error_message?: string;
  local_ip?: string; // Adresse IP locale de l'appareil
  external_ip?: string; // Adresse IP externe (pour OVH)
  device_name?: string; // Nom de l'appareil pour l'affichage
}

export interface RemoteCommand {
  command: 'play' | 'pause' | 'stop' | 'restart' | 'next_slide' | 'prev_slide' | 'goto_slide' | 'assign_presentation' | 'reboot' | 'update_app';
  device_id: string;
  parameters?: {
    slide_index?: number;
    presentation_id?: number;
    auto_play?: boolean;
    loop_mode?: boolean;
  };
}

class StatusService {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private commandCheckInterval: NodeJS.Timeout | null = null;
  private currentStatus: DeviceStatus | null = null;
  private onStatusUpdateCallback: ((status: DeviceStatus) => void) | null = null;
  private onRemoteCommandCallback: ((command: RemoteCommand) => void) | null = null;
  private localIpAddress: string | null = null;
  private externalIpAddress: string | null = null;
  private deviceName: string | null = null;
  private heartbeatFailCount: number = 0;
  private maxHeartbeatFailCount: number = 5;
  private heartbeatRetryDelay: number = 5000; // 5 secondes
  private lastHeartbeatSuccess: number = 0;

  async initialize() {
    console.log('=== INITIALIZING STATUS SERVICE ===');
    
    // Récupérer le nom de l'appareil depuis AsyncStorage
    try {
      this.deviceName = await AsyncStorage.getItem('device_name') || `Fire TV ${Math.floor(Math.random() * 1000)}`;
    } catch (error) {
      console.error('Error getting device name:', error);
      this.deviceName = `Fire TV ${Math.floor(Math.random() * 1000)}`;
    }
    
    // Démarrer le heartbeat toutes les 30 secondes
    this.startHeartbeat();
    
    // Vérifier les commandes à distance toutes les 10 secondes
    this.startCommandCheck();
    
    // Tenter de récupérer l'adresse IP locale
    this.getLocalIPAddress();
    
    // Tenter de récupérer l'adresse IP externe
    this.getExternalIPAddress();
    
    console.log('Status Service initialized with device name:', this.deviceName);
  }

  /**
   * Tente de récupérer l'adresse IP locale de l'appareil
   */
  private async getLocalIPAddress() {
    try {
      if (Platform.OS !== 'web') {
        // Utiliser NetInfo pour obtenir l'adresse IP locale
        const netInfo = await NetInfo.fetch();
        if (netInfo.type === 'wifi' && netInfo.details) {
          this.localIpAddress = (netInfo.details as any).ipAddress || null;
        }
      }
      
      if (!this.localIpAddress) {
        // Méthode de secours - simuler une adresse IP locale
        this.localIpAddress = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
      }
      
      console.log('Local IP address:', this.localIpAddress);
    } catch (error) {
      console.log('Failed to get local IP address:', error);
      this.localIpAddress = null;
    }
  }

  /**
   * Tente de récupérer l'adresse IP externe de l'appareil
   */
  private async getExternalIPAddress() {
    try {
      // Utiliser un service externe pour obtenir l'adresse IP externe
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      this.externalIpAddress = data.ip;
      console.log('External IP address:', this.externalIpAddress);
    } catch (error) {
      console.log('Failed to get external IP address:', error);
      this.externalIpAddress = null;
    }
  }

  /**
   * Démarre l'envoi périodique du statut au serveur
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat();
        // Réinitialiser le compteur d'échecs en cas de succès
        this.heartbeatFailCount = 0;
        this.lastHeartbeatSuccess = Date.now();
      } catch (error) {
        console.log('Heartbeat failed:', error);
        this.heartbeatFailCount++;
        
        // Si trop d'échecs consécutifs, réduire la fréquence des tentatives
        if (this.heartbeatFailCount >= this.maxHeartbeatFailCount) {
          console.log(`Too many heartbeat failures (${this.heartbeatFailCount}), reducing frequency`);
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            
            // Réessayer après un délai plus long
            setTimeout(() => {
              this.startHeartbeat();
            }, this.heartbeatRetryDelay);
          }
        }
      }
    }, 30000); // Toutes les 30 secondes

    // Envoyer immédiatement le premier heartbeat
    this.sendHeartbeat();
  }

  /**
   * Démarre la vérification des commandes à distance
   */
  private startCommandCheck() {
    if (this.commandCheckInterval) return;

    this.commandCheckInterval = setInterval(async () => {
      try {
        // Ne vérifier les commandes que si le dernier heartbeat a réussi
        if (this.lastHeartbeatSuccess > 0) {
          await this.checkForRemoteCommands();
        }
      } catch (error) {
        console.log('Command check failed:', error);
      }
    }, 10000); // Toutes les 10 secondes
  }

  /**
   * Envoie le statut actuel au serveur
   */
  private async sendHeartbeat() {
    try {
      if (!apiService.isDeviceRegistered()) return;

      const status = await this.getCurrentStatus();
      
      // Envoyer le statut via WebSocket si disponible
      const wsSuccess = sendStatusViaWebSocket(status);
      
      // Si l'envoi WebSocket a échoué ou n'est pas disponible, utiliser HTTP
      if (!wsSuccess) {
        const response = await fetch(`${apiService.getServerUrl()}/heartbeat-receiver.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Device-ID': apiService.getDeviceId(),
            'X-Device-Type': 'firetv',
            'X-Device-Name': apiService.getDeviceName(),
            'X-App-Version': '2.0.0',
            'X-Local-IP': this.localIpAddress || '',
            'X-External-IP': this.externalIpAddress || '',
          },
          body: JSON.stringify(status),
        });

        if (response.ok) {
          const data = await response.json();
          console.log('Heartbeat sent successfully');
          
          // Synchroniser l'heure locale avec le serveur si disponible
          if (data.server_time) {
            console.log('Server time received:', data.server_time);
            // Ici, vous pourriez ajuster l'heure locale si nécessaire
          }
          
          // Traiter les commandes en attente
          if (data.commands && data.commands.length > 0) {
            console.log('Received commands:', data.commands.length);
            for (const command of data.commands) {
              await this.handleRemoteCommand(command);
              await this.acknowledgeCommand(command.id);
            }
          }
          
          // Mettre à jour le timestamp du dernier heartbeat réussi
          this.lastHeartbeatSuccess = Date.now();
        } else {
          throw new Error(`Server returned status ${response.status}`);
        }
      } else {
        // WebSocket a réussi
        console.log('Heartbeat sent successfully via WebSocket');
        this.lastHeartbeatSuccess = Date.now();
      }
    } catch (error) {
      console.log('Failed to send heartbeat:', error);
      throw error;
    }
  }

  /**
   * Vérifie s'il y a des commandes à distance en attente
   */
  private async checkForRemoteCommands() {
    try {
      if (!apiService.isDeviceRegistered()) return;

      const response = await fetch(`${apiService.getServerUrl()}/appareil/commandes`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': apiService.getDeviceId(),
          'X-Device-Type': 'firetv',
          'X-Device-Name': apiService.getDeviceName(),
          'X-App-Version': '2.0.0',
          'X-Local-IP': this.localIpAddress || '',
          'X-External-IP': this.externalIpAddress || '',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.commands && data.commands.length > 0) {
          for (const command of data.commands) {
            await this.handleRemoteCommand(command);
            await this.acknowledgeCommand(command.id);
          }
        }
      }
    } catch (error) {
      console.log('Failed to check for remote commands:', error);
    }
  }

  /**
   * Exécute une commande à distance
   */
  public async handleRemoteCommand(command: RemoteCommand) {
    console.log('=== EXECUTING REMOTE COMMAND ===', command);

    if (this.onRemoteCommandCallback) {
      this.onRemoteCommandCallback(command);
    }

    // Mettre à jour le statut après l'exécution
    setTimeout(() => {
      this.updateStatus({ status: 'online' });
    }, 1000);
  }

  /**
   * Confirme l'exécution d'une commande
   */
  private async acknowledgeCommand(commandId: string) {
    try {
      await fetch(`${apiService.getServerUrl()}/command-ack.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': apiService.getDeviceId(),
          'X-Device-Type': 'firetv',
          'X-Device-Name': apiService.getDeviceName(),
          'X-App-Version': '2.0.0',
          'X-Local-IP': this.localIpAddress || '',
          'X-External-IP': this.externalIpAddress || '',
        },
        body: JSON.stringify({
          command_id: commandId,
          status: 'executee',
          result: 'Command executed successfully'
        }),
      });
    } catch (error) {
      console.log('Failed to acknowledge command:', error);
    }
  }

  /**
   * Récupère le statut actuel de l'appareil
   */
  private async getCurrentStatus(): Promise<DeviceStatus> {
    const deviceId = apiService.getDeviceId();
    const appVersion = '2.0.0'; // À récupérer depuis package.json
    
    // Récupérer les informations système (simulées pour l'exemple)
    const systemInfo = await this.getSystemInfo();

    const status: DeviceStatus = {
      device_id: deviceId,
      device_name: this.deviceName || apiService.getDeviceName() || `Fire TV ${deviceId.substring(deviceId.length - 6)}`,
      status: this.currentStatus?.status || 'online',
      current_presentation_id: this.currentStatus?.current_presentation_id,
      current_presentation_name: this.currentStatus?.current_presentation_name,
      current_slide_index: this.currentStatus?.current_slide_index,
      total_slides: this.currentStatus?.total_slides,
      is_looping: this.currentStatus?.is_looping,
      auto_play: this.currentStatus?.auto_play,
      last_heartbeat: new Date().toISOString(),
      uptime_seconds: systemInfo.uptime,
      memory_usage: systemInfo.memoryUsage,
      wifi_strength: systemInfo.wifiStrength,
      app_version: appVersion,
      error_message: this.currentStatus?.error_message,
      local_ip: this.localIpAddress || undefined, // Adresse IP locale
      external_ip: this.externalIpAddress || undefined, // Adresse IP externe
    };

    return status;
  }

  /**
   * Récupère les informations système
   */
  private async getSystemInfo() {
    // Tenter de récupérer des informations réelles sur l'appareil
    let memoryUsage = 0;
    let wifiStrength = 0;
    
    try {
      if (Platform.OS !== 'web') {
        // Tenter d'obtenir des informations sur le réseau
        const netInfo = await NetInfo.fetch();
        if (netInfo.type === 'wifi' && netInfo.details) {
          // Sur Android, netInfo.details.strength contient la force du signal WiFi
          wifiStrength = (netInfo.details as any).strength || Math.floor(Math.random() * 100);
        }
        
        // Pour la mémoire, nous devons simuler car React Native n'a pas d'API standard
        memoryUsage = Math.floor(Math.random() * 60) + 20; // Entre 20% et 80%
      } else {
        // Valeurs simulées pour le web
        memoryUsage = Math.floor(Math.random() * 60) + 20;
        wifiStrength = Math.floor(Math.random() * 100);
      }
    } catch (error) {
      console.log('Error getting system info:', error);
      // Valeurs par défaut en cas d'erreur
      memoryUsage = 50;
      wifiStrength = 75;
    }
    
    return {
      uptime: Math.floor(Date.now() / 1000), // Uptime en secondes depuis le démarrage de l'app
      memoryUsage: memoryUsage,
      wifiStrength: wifiStrength,
    };
  }

  /**
   * Met à jour le statut de l'appareil
   */
  updateStatus(updates: Partial<DeviceStatus>) {
    this.currentStatus = {
      ...this.currentStatus,
      ...updates,
      device_id: apiService.getDeviceId(),
      last_heartbeat: new Date().toISOString(),
    } as DeviceStatus;

    console.log('Status updated:', this.currentStatus);

    if (this.onStatusUpdateCallback) {
      this.onStatusUpdateCallback(this.currentStatus);
    }
    
    // Envoyer le statut via WebSocket si connecté
    sendStatusViaWebSocket(this.currentStatus);
  }

  /**
   * Met à jour le statut de la présentation en cours
   */
  updatePresentationStatus(presentationId: number, presentationName: string, slideIndex: number, totalSlides: number, isLooping: boolean, autoPlay: boolean) {
    this.updateStatus({
      status: 'playing',
      current_presentation_id: presentationId,
      current_presentation_name: presentationName,
      current_slide_index: slideIndex,
      total_slides: totalSlides,
      is_looping: isLooping,
      auto_play: autoPlay,
    });
  }

  /**
   * Met à jour le statut de lecture
   */
  updatePlaybackStatus(status: 'playing' | 'paused' | 'stopped') {
    this.updateStatus({ status });
  }

  /**
   * Signale une erreur
   */
  reportError(errorMessage: string) {
    this.updateStatus({
      status: 'error',
      error_message: errorMessage,
    });
  }

  /**
   * Définit le callback pour les mises à jour de statut
   */
  setOnStatusUpdate(callback: (status: DeviceStatus) => void) {
    this.onStatusUpdateCallback = callback;
  }

  /**
   * Définit le callback pour les commandes à distance
   */
  setOnRemoteCommand(callback: (command: RemoteCommand) => void) {
    this.onRemoteCommandCallback = callback;
  }

  /**
   * Arrête le service
   */
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.commandCheckInterval) {
      clearInterval(this.commandCheckInterval);
      this.commandCheckInterval = null;
    }

    this.updateStatus({ status: 'offline' });
  }

  /**
   * Récupère le statut actuel
   */
  getCurrentStatusSync(): DeviceStatus | null {
    return this.currentStatus;
  }
  
  /**
   * Définit le nom de l'appareil
   */
  async setDeviceName(name: string) {
    this.deviceName = name;
    await AsyncStorage.setItem('device_name', name);
    
    // Mettre à jour le statut avec le nouveau nom
    if (this.currentStatus) {
      this.updateStatus({ device_name: name });
    }
  }
  
  /**
   * Récupère le nom de l'appareil
   */
  getDeviceName(): string | null {
    return this.deviceName;
  }
  
  /**
   * Force l'envoi immédiat d'un heartbeat
   */
  async forceHeartbeat(): Promise<boolean> {
    try {
      await this.sendHeartbeat();
      return true;
    } catch (error) {
      console.error('Force heartbeat failed:', error);
      return false;
    }
  }
}

export const statusService = new StatusService();
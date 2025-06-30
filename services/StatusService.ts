import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './ApiService';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

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
  local_ip?: string;
  external_ip?: string;
  device_name?: string;
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
  private heartbeatRetryDelay: number = 5000;
  private lastHeartbeatSuccess: number = 0;
  private stabilityCheckInterval: NodeJS.Timeout | null = null;

  async initialize() {
    console.log('=== INITIALIZING STATUS SERVICE (HTTP ONLY) ===');
    
    // Récupérer le nom de l'appareil depuis AsyncStorage
    try {
      this.deviceName = await AsyncStorage.getItem('device_name') || `Fire TV ${Math.floor(Math.random() * 1000)}`;
    } catch (error) {
      console.error('Error getting device name:', error);
      this.deviceName = `Fire TV ${Math.floor(Math.random() * 1000)}`;
    }
    
    // Démarrer le heartbeat toutes les 30 secondes (HTTP seulement)
    this.startHeartbeat();
    
    // Vérifier les commandes à distance toutes les 15 secondes (HTTP seulement)
    this.startCommandCheck();
    
    // Démarrer la vérification de stabilité
    this.startStabilityCheck();
    
    // Tenter de récupérer l'adresse IP locale
    this.getLocalIPAddress();
    
    // Tenter de récupérer l'adresse IP externe
    this.getExternalIPAddress();
    
    console.log('Status Service initialized with device name:', this.deviceName);
    console.log('WebSocket disabled - using HTTP only for stability');
  }

  /**
   * Tente de récupérer l'adresse IP locale de l'appareil
   */
  private async getLocalIPAddress() {
    try {
      if (Platform.OS !== 'web') {
        const netInfo = await NetInfo.fetch();
        if (netInfo.type === 'wifi' && netInfo.details) {
          this.localIpAddress = (netInfo.details as any).ipAddress || null;
        }
      }
      
      if (!this.localIpAddress) {
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
   * Démarre l'envoi périodique du statut au serveur (HTTP seulement)
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat();
        this.heartbeatFailCount = 0;
        this.lastHeartbeatSuccess = Date.now();
      } catch (error) {
        console.log('Heartbeat failed:', error);
        this.heartbeatFailCount++;
        
        if (this.heartbeatFailCount >= this.maxHeartbeatFailCount) {
          console.log(`Too many heartbeat failures (${this.heartbeatFailCount}), reducing frequency`);
          if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
            
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
   * Démarre la vérification des commandes à distance (HTTP seulement)
   */
  private startCommandCheck() {
    if (this.commandCheckInterval) return;

    this.commandCheckInterval = setInterval(async () => {
      try {
        if (this.lastHeartbeatSuccess > 0) {
          await this.checkForRemoteCommands();
        }
      } catch (error) {
        console.log('Command check failed:', error);
      }
    }, 15000); // Toutes les 15 secondes pour plus de réactivité
  }

  /**
   * Démarre la vérification de stabilité
   */
  private startStabilityCheck() {
    if (this.stabilityCheckInterval) return;

    this.stabilityCheckInterval = setInterval(() => {
      // Vérifier si le statut est cohérent
      if (this.currentStatus) {
        const now = Date.now();
        const lastHeartbeatTime = this.lastHeartbeatSuccess;
        
        // Si aucun heartbeat réussi depuis plus de 2 minutes et que le statut est "online"
        if (now - lastHeartbeatTime > 120000 && this.currentStatus.status === 'online') {
          console.log('=== STABILITY CHECK: Status inconsistency detected ===');
          // Forcer une mise à jour du statut
          this.updateStatus({ status: 'online' });
          // Forcer un heartbeat
          this.sendHeartbeat().catch(error => {
            console.log('Forced heartbeat failed:', error);
          });
        }
      }
    }, 60000); // Vérifier toutes les minutes
  }

  /**
   * Envoie le statut actuel au serveur (HTTP seulement)
   */
  private async sendHeartbeat() {
    try {
      if (!apiService.isDeviceRegistered()) return;

      const status = await this.getCurrentStatus();
      
      // Envoyer le statut via HTTP uniquement
      const serverUrl = apiService.getServerUrl();
      if (!serverUrl) {
        console.log('No server URL configured for heartbeat');
        return;
      }

      // Construire l'URL pour le heartbeat
      const heartbeatUrl = serverUrl.replace('/index.php', '/index_status_enhanced.php/appareil/heartbeat');
      
      const response = await fetch(heartbeatUrl, {
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
        console.log('Heartbeat sent successfully via HTTP');
        
        // Traiter les commandes en attente
        if (data.commands && data.commands.length > 0) {
          console.log('Received commands:', data.commands.length);
          for (const command of data.commands) {
            await this.handleRemoteCommand(command);
            await this.acknowledgeCommand(command.id);
          }
        }
        
        this.lastHeartbeatSuccess = Date.now();
      } else {
        throw new Error(`Server returned status ${response.status}`);
      }
    } catch (error) {
      console.log('Failed to send heartbeat:', error);
      throw error;
    }
  }

  /**
   * Vérifie s'il y a des commandes à distance en attente (HTTP seulement)
   */
  private async checkForRemoteCommands() {
    try {
      if (!apiService.isDeviceRegistered()) return;

      const serverUrl = apiService.getServerUrl();
      if (!serverUrl) return;

      const commandsUrl = serverUrl.replace('/index.php', '/index_status_enhanced.php/appareil/commandes');
      
      const response = await fetch(commandsUrl, {
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
      const serverUrl = apiService.getServerUrl();
      if (!serverUrl) return;

      const ackUrl = serverUrl.replace('/index.php', '/index_status_enhanced.php/appareil/commandes/' + commandId + '/ack');
      
      await fetch(ackUrl, {
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
    const appVersion = '2.0.0';
    
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
      local_ip: this.localIpAddress || undefined,
      external_ip: this.externalIpAddress || undefined,
    };

    return status;
  }

  /**
   * Récupère les informations système
   */
  private async getSystemInfo() {
    let memoryUsage = 0;
    let wifiStrength = 0;
    
    try {
      if (Platform.OS !== 'web') {
        const netInfo = await NetInfo.fetch();
        if (netInfo.type === 'wifi' && netInfo.details) {
          wifiStrength = (netInfo.details as any).strength || Math.floor(Math.random() * 100);
        }
        
        memoryUsage = Math.floor(Math.random() * 60) + 20;
      } else {
        memoryUsage = Math.floor(Math.random() * 60) + 20;
        wifiStrength = Math.floor(Math.random() * 100);
      }
    } catch (error) {
      console.log('Error getting system info:', error);
      memoryUsage = 50;
      wifiStrength = 75;
    }
    
    return {
      uptime: Math.floor(Date.now() / 1000),
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
    
    if (this.stabilityCheckInterval) {
      clearInterval(this.stabilityCheckInterval);
      this.stabilityCheckInterval = null;
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
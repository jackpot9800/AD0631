import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  Server, 
  Wifi, 
  WifiOff, 
  Check, 
  CircleAlert as AlertCircle, 
  Monitor, 
  Settings as SettingsIcon, 
  RefreshCw, 
  Trash2, 
  UserPlus, 
  Activity, 
  Zap,
  Play,
  Pause,
  Moon,
  Radio
} from 'lucide-react-native';
import { apiService } from '@/services/ApiService';
import { statusService } from '@/services/StatusService';
import { getWebSocketService, initWebSocketService } from '@/services/WebSocketService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { activateKeepAwake, deactivateKeepAwake, useKeepAwake } from 'expo-keep-awake';

// Définition des clés de stockage pour éviter les erreurs
const STORAGE_KEYS = {
  SERVER_URL: 'server_url',
  DEVICE_ID: 'device_id',
  DEVICE_REGISTERED: 'device_registered',
  ENROLLMENT_TOKEN: 'enrollment_token',
  ASSIGNED_PRESENTATION: 'assigned_presentation',
  DEFAULT_PRESENTATION: 'default_presentation',
  KEEP_AWAKE_ENABLED: 'keep_awake_enabled',
  WEBSOCKET_ENABLED: 'websocket_enabled',
};

// Import conditionnel de TVEventHandler
let TVEventHandler: any = null;
if (Platform.OS === 'android' || Platform.OS === 'ios') {
  try {
    TVEventHandler = require('react-native').TVEventHandler;
  } catch (error) {
    console.log('TVEventHandler not available on this platform');
  }
}

export default function SettingsScreen() {
  const [serverUrl, setServerUrl] = useState('');
  const [originalUrl, setOriginalUrl] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [tvEventHandler, setTvEventHandler] = useState<any>(null);
  
  // Nouveaux états pour les paramètres avancés
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [remoteControlEnabled, setRemoteControlEnabled] = useState(true);
  const [statusReportingEnabled, setStatusReportingEnabled] = useState(true);
  const [autoRestartEnabled, setAutoRestartEnabled] = useState(true);
  const [memoryOptimizationEnabled, setMemoryOptimizationEnabled] = useState(true);
  const [deviceStatus, setDeviceStatus] = useState<string>('online');
  const [connectionError, setConnectionError] = useState<string>('');
  
  // État pour le mode anti-veille
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(true);
  
  // État pour le WebSocket
  const [webSocketEnabled, setWebSocketEnabled] = useState(true);
  const [webSocketStatus, setWebSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  // Utiliser le hook useKeepAwake si activé
  if (keepAwakeEnabled && Platform.OS !== 'web') {
    useKeepAwake();
  }

  useEffect(() => {
    loadCurrentSettings();
    loadDebugInfo();
    loadAdvancedSettings();
    
    // Configuration Fire TV seulement sur les plateformes supportées
    if (Platform.OS === 'android' && TVEventHandler) {
      setupFireTVNavigation();
    }

    return () => {
      if (tvEventHandler) {
        try {
          tvEventHandler.disable();
        } catch (error) {
          console.log('Error disabling TV event handler:', error);
        }
      }
    };
  }, []);

  useEffect(() => {
    setHasChanges(serverUrl !== originalUrl);
  }, [serverUrl, originalUrl]);

  // Configuration navigation Fire TV avec vérifications
  const setupFireTVNavigation = () => {
    if (!TVEventHandler) {
      console.log('TVEventHandler not available');
      return;
    }

    try {
      const handler = new TVEventHandler();
      handler.enable(null, (cmp: any, evt: any) => {
        if (!evt) return;

        console.log('Settings Fire TV Event:', evt.eventType);

        switch (evt.eventType) {
          case 'down':
            handleNavigateDown();
            break;
          case 'up':
            handleNavigateUp();
            break;
          case 'select':
            handleSelectAction();
            break;
          case 'back':
            // Laisser le comportement par défaut
            break;
        }
      });
      setTvEventHandler(handler);
    } catch (error) {
      console.log('TVEventHandler not available in settings:', error);
    }
  };

  const handleNavigateDown = () => {
    const maxIndex = 12; // Ajusté pour inclure les nouveaux paramètres
    if (focusedIndex < maxIndex) {
      setFocusedIndex(focusedIndex + 1);
    }
  };

  const handleNavigateUp = () => {
    if (focusedIndex > 0) {
      setFocusedIndex(focusedIndex - 1);
    }
  };

  const handleSelectAction = () => {
    switch (focusedIndex) {
      case 0:
        // Input field - ne rien faire, laisser le clavier apparaître
        break;
      case 1:
        testConnection(serverUrl);
        break;
      case 2:
        if (hasChanges && !saving) {
          saveSettings();
        }
        break;
      case 3:
        registerDevice();
        break;
      case 4:
        loadDebugInfo();
        break;
      case 5:
        resetDevice();
        break;
      case 6:
        resetSettings();
        break;
      case 7:
        setShowAdvancedSettings(!showAdvancedSettings);
        break;
      case 8:
        setRemoteControlEnabled(!remoteControlEnabled);
        break;
      case 9:
        setStatusReportingEnabled(!statusReportingEnabled);
        break;
      case 10:
        setMemoryOptimizationEnabled(!memoryOptimizationEnabled);
        break;
      case 11:
        toggleKeepAwake();
        break;
      case 12:
        toggleWebSocket();
        break;
    }
  };

  const loadCurrentSettings = () => {
    const currentUrl = apiService.getServerUrl();
    setServerUrl(currentUrl);
    setOriginalUrl(currentUrl);
  };

  const loadDebugInfo = async () => {
    try {
      const info = await apiService.getDebugInfo();
      setDebugInfo(info);
      
      // Récupérer la dernière erreur de connexion
      setConnectionError(info.lastConnectionError || '');
      
      // Récupérer le statut actuel
      const status = statusService.getCurrentStatusSync();
      if (status) {
        setDeviceStatus(status.status);
      }
      
      // Vérifier le statut WebSocket
      const wsService = getWebSocketService();
      if (wsService) {
        setWebSocketStatus(wsService.isConnectedToServer() ? 'connected' : 'disconnected');
      }
    } catch (error) {
      console.error('Error loading debug info:', error);
    }
  };

  const loadAdvancedSettings = async () => {
    try {
      // Charger les paramètres avancés depuis AsyncStorage
      const remoteControl = await AsyncStorage.getItem('settings_remote_control');
      const statusReporting = await AsyncStorage.getItem('settings_status_reporting');
      const autoRestart = await AsyncStorage.getItem('settings_auto_restart');
      const memoryOptimization = await AsyncStorage.getItem('settings_memory_optimization');
      const keepAwake = await AsyncStorage.getItem(STORAGE_KEYS.KEEP_AWAKE_ENABLED);
      const webSocket = await AsyncStorage.getItem(STORAGE_KEYS.WEBSOCKET_ENABLED);
      
      setRemoteControlEnabled(remoteControl !== 'false');
      setStatusReportingEnabled(statusReporting !== 'false');
      setAutoRestartEnabled(autoRestart !== 'false');
      setMemoryOptimizationEnabled(memoryOptimization !== 'false');
      setKeepAwakeEnabled(keepAwake !== 'false');
      setWebSocketEnabled(webSocket !== 'false');
    } catch (error) {
      console.error('Error loading advanced settings:', error);
    }
  };

  const saveAdvancedSettings = async () => {
    try {
      await AsyncStorage.setItem('settings_remote_control', remoteControlEnabled.toString());
      await AsyncStorage.setItem('settings_status_reporting', statusReportingEnabled.toString());
      await AsyncStorage.setItem('settings_auto_restart', autoRestartEnabled.toString());
      await AsyncStorage.setItem('settings_memory_optimization', memoryOptimizationEnabled.toString());
      await AsyncStorage.setItem(STORAGE_KEYS.KEEP_AWAKE_ENABLED, keepAwakeEnabled.toString());
      await AsyncStorage.setItem(STORAGE_KEYS.WEBSOCKET_ENABLED, webSocketEnabled.toString());
      
      // Appliquer le paramètre de veille immédiatement
      if (Platform.OS !== 'web') {
        if (keepAwakeEnabled) {
          activateKeepAwake();
        } else {
          deactivateKeepAwake();
        }
      }
      
      // Appliquer le paramètre WebSocket immédiatement
      if (webSocketEnabled) {
        try {
          await initWebSocketService();
          setWebSocketStatus('connected');
        } catch (error) {
          console.error('Error initializing WebSocket service:', error);
          setWebSocketStatus('disconnected');
        }
      } else {
        const wsService = getWebSocketService();
        if (wsService) {
          wsService.disconnect();
          setWebSocketStatus('disconnected');
        }
      }
      
      Alert.alert(
        'Paramètres avancés sauvegardés',
        'Les paramètres avancés ont été sauvegardés avec succès.',
        [{ text: 'OK' }]
      );
    } catch (error) {
      console.error('Error saving advanced settings:', error);
      Alert.alert(
        'Erreur',
        'Impossible de sauvegarder les paramètres avancés.',
        [{ text: 'OK' }]
      );
    }
  };

  // Fonction pour activer/désactiver le mode anti-veille
  const toggleKeepAwake = () => {
    const newValue = !keepAwakeEnabled;
    setKeepAwakeEnabled(newValue);
    
    if (Platform.OS !== 'web') {
      if (newValue) {
        activateKeepAwake();
        console.log('Keep awake mode activated');
      } else {
        deactivateKeepAwake();
        console.log('Keep awake mode deactivated');
      }
    }
    
    // Sauvegarder le paramètre
    AsyncStorage.setItem(STORAGE_KEYS.KEEP_AWAKE_ENABLED, newValue.toString());
  };
  
  // Fonction pour activer/désactiver le WebSocket
  const toggleWebSocket = async () => {
    const newValue = !webSocketEnabled;
    setWebSocketEnabled(newValue);
    
    if (newValue) {
      try {
        setWebSocketStatus('connecting');
        await initWebSocketService();
        setWebSocketStatus('connected');
      } catch (error) {
        console.error('Error initializing WebSocket service:', error);
        setWebSocketStatus('disconnected');
      }
    } else {
      const wsService = getWebSocketService();
      if (wsService) {
        wsService.disconnect();
        setWebSocketStatus('disconnected');
      }
    }
    
    // Sauvegarder le paramètre
    AsyncStorage.setItem(STORAGE_KEYS.WEBSOCKET_ENABLED, newValue.toString());
  };

  const testConnection = async (url: string) => {
    if (!url.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer une URL de serveur valide.');
      return;
    }

    setConnectionStatus('testing');
    try {
      const testUrl = url.replace(/\/+$/, '');
      const finalUrl = testUrl.endsWith('index.php') ? testUrl : `${testUrl}/index.php`;
      
      console.log('Testing connection to:', finalUrl);
      
      // Créer une instance temporaire pour tester
      const tempApiService = { ...apiService };
      
      // Définir l'URL temporairement pour le test
      await AsyncStorage.setItem(STORAGE_KEYS.SERVER_URL, finalUrl);
      
      // Tester directement avec fetch pour éviter les problèmes de configuration
      const response = await fetch(`${finalUrl}/version`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'PresentationKiosk/2.0 (FireTV; OVH-Compatible)',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Accept-Encoding': 'gzip, deflate',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        },
      });
      
      console.log('Test response status:', response.status);
      
      if (response.ok) {
        const responseText = await response.text();
        console.log('Test response text:', responseText);
        
        try {
          const data = JSON.parse(responseText);
          console.log('Test response data:', data);
          
          if (data.api_status === 'running' || data.status === 'running' || data.version) {
            setConnectionStatus('success');
            
            Alert.alert(
              'Test de connexion réussi',
              `Connexion au serveur établie avec succès !\n\nVersion API: ${data.version || 'N/A'}\nStatut: ${data.api_status || data.status || 'running'}\nFuseau horaire: ${data.timezone || 'N/A'}`,
              [{ text: 'OK' }]
            );
            return true;
          }
        } catch (parseError) {
          console.error('Error parsing JSON response:', parseError);
          console.error('Response text:', responseText);
        }
      }
      
      setConnectionStatus('error');
      Alert.alert(
        'Test de connexion échoué',
        `Impossible de se connecter au serveur.\n\nStatut HTTP: ${response.status}\n\nVérifiez l'URL et que le serveur est accessible.`,
        [{ text: 'OK' }]
      );
      return false;
    } catch (error) {
      console.error('Connection test failed:', error);
      setConnectionStatus('error');
      
      Alert.alert(
        'Erreur de connexion',
        `Impossible de joindre le serveur:\n\n${error instanceof Error ? error.message : 'Erreur réseau'}\n\nVérifiez votre connexion réseau et l'URL du serveur.`,
        [{ text: 'OK' }]
      );
      return false;
    }
  };

  const saveSettings = async () => {
    if (!serverUrl.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer une URL de serveur valide.');
      return;
    }

    setSaving(true);
    
    try {
      console.log('=== SAVING SETTINGS ===');
      console.log('Server URL:', serverUrl.trim());
      
      const success = await apiService.setServerUrl(serverUrl.trim());
      
      if (success) {
        setOriginalUrl(serverUrl.trim());
        setConnectionStatus('success');
        await loadDebugInfo();
        
        // Initialiser le service WebSocket si activé
        if (webSocketEnabled) {
          try {
            setWebSocketStatus('connecting');
            await initWebSocketService();
            setWebSocketStatus('connected');
          } catch (error) {
            console.error('Error initializing WebSocket service:', error);
            setWebSocketStatus('disconnected');
          }
        }
        
        Alert.alert(
          'Configuration sauvegardée',
          'La configuration a été sauvegardée avec succès et l\'appareil a été enregistré sur le serveur.',
          [{ text: 'Parfait !' }]
        );
      } else {
        setConnectionStatus('error');
        Alert.alert(
          'Erreur de sauvegarde',
          'Impossible de sauvegarder la configuration. Vérifiez l\'URL et la disponibilité du serveur.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setConnectionStatus('error');
      Alert.alert(
        'Erreur de sauvegarde',
        `Une erreur est survenue lors de la sauvegarde:\n\n${error instanceof Error ? error.message : 'Erreur inconnue'}\n\nVeuillez réessayer.`,
        [{ text: 'OK' }]
      );
    } finally {
      setSaving(false);
    }
  };

  const registerDevice = async () => {
    if (!serverUrl.trim()) {
      Alert.alert(
        'Configuration requise',
        'Veuillez d\'abord configurer et sauvegarder l\'URL du serveur.',
        [{ text: 'OK' }]
      );
      return;
    }

    setRegistering(true);
    
    try {
      console.log('=== MANUAL DEVICE REGISTRATION ===');
      
      // Vérifier d'abord si l'appareil est déjà enregistré
      if (apiService.isDeviceRegistered()) {
        Alert.alert(
          'Appareil déjà enregistré',
          `Cet appareil est déjà enregistré sur le serveur.\n\nID: ${apiService.getDeviceId()}\n\nVoulez-vous forcer un nouvel enregistrement ?`,
          [
            { text: 'Annuler', style: 'cancel' },
            { 
              text: 'Forcer', 
              style: 'destructive',
              onPress: async () => {
                await apiService.resetDevice();
                await performRegistration();
              }
            }
          ]
        );
        return;
      }

      await performRegistration();
      
    } catch (error) {
      console.error('Manual registration failed:', error);
      Alert.alert(
        'Erreur d\'enregistrement',
        `Impossible d'enregistrer l'appareil:\n\n${error instanceof Error ? error.message : 'Erreur inconnue'}\n\nVérifiez votre connexion et l'URL du serveur.`,
        [{ text: 'OK' }]
      );
    } finally {
      setRegistering(false);
    }
  };

  const performRegistration = async () => {
    try {
      console.log('=== PERFORMING DEVICE REGISTRATION ===');
      
      // Tester la connexion d'abord
      const connectionOk = await apiService.testConnection();
      if (!connectionOk) {
        throw new Error('Impossible de se connecter au serveur');
      }

      console.log('Connection OK, proceeding with registration...');

      // Enregistrer l'appareil
      const registrationOk = await apiService.registerDevice();
      if (registrationOk) {
        await loadDebugInfo();
        
        // Initialiser le service WebSocket si activé
        if (webSocketEnabled) {
          try {
            setWebSocketStatus('connecting');
            await initWebSocketService();
            setWebSocketStatus('connected');
          } catch (error) {
            console.error('Error initializing WebSocket service:', error);
            setWebSocketStatus('disconnected');
          }
        }
        
        Alert.alert(
          'Enregistrement réussi !',
          `L'appareil a été enregistré avec succès sur le serveur.\n\nID: ${apiService.getDeviceId()}\n\nVous pouvez maintenant utiliser toutes les fonctionnalités de l'application.`,
          [{ text: 'Parfait !' }]
        );
      } else {
        throw new Error('L\'enregistrement a échoué sans message d\'erreur');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  };

  const resetSettings = () => {
    Alert.alert(
      'Réinitialiser les paramètres',
      'Êtes-vous sûr de vouloir effacer la configuration du serveur ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réinitialiser',
          style: 'destructive',
          onPress: async () => {
            setServerUrl('');
            setConnectionStatus('idle');
            await apiService.resetDevice();
            await loadDebugInfo();
            
            // Déconnecter le WebSocket
            const wsService = getWebSocketService();
            if (wsService) {
              wsService.disconnect();
              setWebSocketStatus('disconnected');
            }
            
            Alert.alert(
              'Paramètres réinitialisés',
              'La configuration a été effacée. Vous devez reconfigurer l\'URL du serveur.',
              [{ text: 'OK' }]
            );
          },
        },
      ]
    );
  };

  const resetDevice = () => {
    Alert.alert(
      'Réinitialiser l\'appareil',
      'Cela va supprimer l\'enregistrement de l\'appareil sur le serveur. Vous devrez le reconfigurer.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réinitialiser',
          style: 'destructive',
          onPress: async () => {
            await apiService.resetDevice();
            await loadDebugInfo();
            
            // Déconnecter le WebSocket
            const wsService = getWebSocketService();
            if (wsService) {
              wsService.disconnect();
              setWebSocketStatus('disconnected');
            }
            
            Alert.alert(
              'Appareil réinitialisé',
              'L\'enregistrement de l\'appareil a été supprimé. Utilisez le bouton d\'enregistrement pour le réenregistrer.',
              [{ text: 'OK' }]
            );
          },
        },
      ]
    );
  };

  const renderConnectionStatus = () => {
    const statusConfig = {
      idle: { color: '#6b7280', text: 'Non testé', icon: Server },
      testing: { color: '#f59e0b', text: 'Test en cours...', icon: Wifi },
      success: { color: '#10b981', text: 'Connexion réussie', icon: Check },
      error: { color: '#ef4444', text: 'Connexion échouée', icon: AlertCircle },
    };

    const config = statusConfig[connectionStatus];
    const IconComponent = config.icon;

    return (
      <View style={[styles.statusContainer, { borderColor: config.color }]}>
        <IconComponent size={20} color={config.color} />
        <Text style={[styles.statusText, { color: config.color }]}>
          {config.text}
        </Text>
      </View>
    );
  };

  const renderDeviceStatus = () => {
    const statusConfig: {[key: string]: {color: string, text: string, icon: any}} = {
      online: { color: '#10b981', text: 'En ligne', icon: Activity },
      offline: { color: '#6b7280', text: 'Hors ligne', icon: WifiOff },
      playing: { color: '#3b82f6', text: 'En diffusion', icon: Play },
      paused: { color: '#f59e0b', text: 'En pause', icon: Pause },
      error: { color: '#ef4444', text: 'Erreur', icon: AlertCircle },
    };

    const config = statusConfig[deviceStatus] || statusConfig.offline;
    const IconComponent = config.icon;

    return (
      <View style={[styles.deviceStatusContainer, { borderColor: config.color }]}>
        <IconComponent size={20} color={config.color} />
        <Text style={[styles.statusText, { color: config.color }]}>
          {config.text}
        </Text>
      </View>
    );
  };
  
  const renderWebSocketStatus = () => {
    const statusConfig: {[key: string]: {color: string, text: string, icon: any}} = {
      disconnected: { color: '#6b7280', text: 'Déconnecté', icon: WifiOff },
      connecting: { color: '#f59e0b', text: 'Connexion...', icon: Wifi },
      connected: { color: '#10b981', text: 'Connecté', icon: Radio },
    };

    const config = statusConfig[webSocketStatus];
    const IconComponent = config.icon;

    return (
      <View style={[styles.webSocketStatusContainer, { borderColor: config.color }]}>
        <IconComponent size={20} color={config.color} />
        <Text style={[styles.statusText, { color: config.color }]}>
          {config.text}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <LinearGradient
            colors={['#4f46e5', '#7c3aed']}
            style={styles.headerGradient}
          >
            <SettingsIcon size={32} color="#ffffff" />
          </LinearGradient>
          <Text style={styles.title}>Paramètres Enhanced</Text>
          <Text style={styles.subtitle}>Configuration du serveur et contrôle à distance</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Configuration du serveur</Text>
          <Text style={styles.sectionDescription}>
            Entrez l'URL complète de votre serveur de présentations
          </Text>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>URL du serveur</Text>
            <TextInput
              style={[
                styles.textInput,
                focusedIndex === 0 && styles.focusedInput
              ]}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="http://votre-domaine.fr/mods/livetv/api"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessible={true}
              accessibilityLabel="URL du serveur"
              accessibilityHint="Entrez l'adresse de votre serveur de présentations"
              onFocus={() => setFocusedIndex(0)}
            />
            <Text style={styles.inputHint}>
              L'application ajoutera automatiquement /index.php si nécessaire
            </Text>
          </View>

          {renderConnectionStatus()}
          
          {/* Afficher l'erreur de connexion si présente */}
          {connectionError && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>Dernière erreur de connexion:</Text>
              <Text style={styles.errorMessage}>{connectionError}</Text>
            </View>
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[
                styles.button, 
                styles.testButton,
                (!serverUrl.trim() || connectionStatus === 'testing') && styles.buttonDisabled,
                focusedIndex === 1 && styles.focusedButton
              ]}
              onPress={() => testConnection(serverUrl)}
              disabled={!serverUrl.trim() || connectionStatus === 'testing'}
              accessible={true}
              accessibilityLabel="Tester la connexion"
              accessibilityRole="button"
              onFocus={() => setFocusedIndex(1)}
            >
              {connectionStatus === 'testing' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Wifi size={16} color="#ffffff" />
              )}
              <Text style={styles.buttonText}>Tester la connexion</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.button,
                styles.saveButton,
                (!hasChanges || saving) && styles.buttonDisabled,
                focusedIndex === 2 && styles.focusedButton
              ]}
              onPress={saveSettings}
              disabled={!hasChanges || saving}
              accessible={true}
              accessibilityLabel="Sauvegarder la configuration"
              accessibilityRole="button"
              onFocus={() => setFocusedIndex(2)}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Check size={16} color="#ffffff" />
              )}
              <Text style={styles.buttonText}>Sauvegarder</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enregistrement de l'appareil</Text>
          <Text style={styles.sectionDescription}>
            Enregistrez manuellement cet appareil sur le serveur si l'enregistrement automatique a échoué
          </Text>
          
          <TouchableOpacity
            style={[
              styles.button, 
              styles.registerButton,
              registering && styles.buttonDisabled,
              focusedIndex === 3 && styles.focusedButton
            ]}
            onPress={registerDevice}
            disabled={registering}
            accessible={true}
            accessibilityLabel="Enregistrer l'appareil"
            accessibilityRole="button"
            onFocus={() => setFocusedIndex(3)}
          >
            {registering ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <UserPlus size={16} color="#ffffff" />
            )}
            <Text style={styles.buttonText}>
              {registering ? 'Enregistrement...' : 'Enregistrer l\'appareil'}
            </Text>
          </TouchableOpacity>
          
          <Text style={styles.registerHint}>
            Utilisez ce bouton si l'enregistrement automatique a échoué ou si vous voulez forcer un nouvel enregistrement.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Statut de l'appareil</Text>
          
          <View style={styles.statusRow}>
            {renderDeviceStatus()}
            
            <TouchableOpacity
              style={[
                styles.refreshStatusButton,
                focusedIndex === 4 && styles.focusedButton
              ]}
              onPress={loadDebugInfo}
              accessible={true}
              accessibilityLabel="Actualiser le statut"
              accessibilityRole="button"
              onFocus={() => setFocusedIndex(4)}
            >
              <RefreshCw size={16} color="#ffffff" />
              <Text style={styles.refreshStatusText}>Actualiser</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Monitor size={20} color="#9ca3af" />
              <View style={styles.infoContent}>
                <Text style={styles.infoLabel}>Type d'appareil</Text>
                <Text style={styles.infoValue}>Amazon Fire TV Stick Enhanced</Text>
              </View>
            </View>
            
            {debugInfo && (
              <>
                <View style={styles.infoRow}>
                  <Server size={20} color="#9ca3af" />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>ID de l'appareil</Text>
                    <Text style={styles.infoValue}>{debugInfo.deviceId}</Text>
                  </View>
                </View>
                
                <View style={styles.infoRow}>
                  <Check size={20} color={debugInfo.isRegistered ? "#10b981" : "#ef4444"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Statut d'enregistrement</Text>
                    <Text style={[styles.infoValue, { color: debugInfo.isRegistered ? "#10b981" : "#ef4444" }]}>
                      {debugInfo.isRegistered ? 'Enregistré' : 'Non enregistré'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.infoRow}>
                  <AlertCircle size={20} color={debugInfo.hasToken ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Token d'enrollment</Text>
                    <Text style={styles.infoValue}>
                      {debugInfo.hasToken ? 'Présent' : 'Absent'}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Monitor size={20} color={debugInfo.assignmentCheckEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Surveillance assignations</Text>
                    <Text style={styles.infoValue}>
                      {debugInfo.assignmentCheckEnabled ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>

                <View style={styles.infoRow}>
                  <Monitor size={20} color={debugInfo.defaultCheckEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Surveillance par défaut</Text>
                    <Text style={styles.infoValue}>
                      {debugInfo.defaultCheckEnabled ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.infoRow}>
                  <Zap size={20} color={remoteControlEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Contrôle à distance</Text>
                    <Text style={styles.infoValue}>
                      {remoteControlEnabled ? 'Activé' : 'Désactivé'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.infoRow}>
                  <Moon size={20} color={keepAwakeEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>Mode anti-veille</Text>
                    <Text style={styles.infoValue}>
                      {keepAwakeEnabled ? 'Activé' : 'Désactivé'}
                    </Text>
                  </View>
                </View>
                
                <View style={styles.infoRow}>
                  <Radio size={20} color={webSocketEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.infoContent}>
                    <Text style={styles.infoLabel}>WebSocket</Text>
                    <Text style={styles.infoValue}>
                      {webSocketEnabled ? (webSocketStatus === 'connected' ? 'Connecté' : 'Activé') : 'Désactivé'}
                    </Text>
                  </View>
                </View>
                
                {debugInfo.connectionAttempts > 0 && (
                  <View style={styles.infoRow}>
                    <AlertCircle size={20} color={debugInfo.connectionAttempts > 3 ? "#ef4444" : "#f59e0b"} />
                    <View style={styles.infoContent}>
                      <Text style={styles.infoLabel}>Tentatives de connexion</Text>
                      <Text style={styles.infoValue}>
                        {debugInfo.connectionAttempts}
                      </Text>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Actions</Text>
          
          <TouchableOpacity
            style={[
              styles.button, 
              styles.actionButton,
              focusedIndex === 5 && styles.focusedButton
            ]}
            onPress={resetDevice}
            accessible={true}
            accessibilityLabel="Réinitialiser l'appareil"
            accessibilityRole="button"
            onFocus={() => setFocusedIndex(5)}
          >
            <Trash2 size={16} color="#f59e0b" />
            <Text style={[styles.buttonText, { color: '#f59e0b' }]}>
              Réinitialiser l'appareil
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.button, 
              styles.resetButton,
              focusedIndex === 6 && styles.focusedButton
            ]}
            onPress={resetSettings}
            accessible={true}
            accessibilityLabel="Réinitialiser les paramètres"
            accessibilityRole="button"
            onFocus={() => setFocusedIndex(6)}
          >
            <AlertCircle size={16} color="#ef4444" />
            <Text style={[styles.buttonText, { color: '#ef4444' }]}>
              Réinitialiser les paramètres
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.advancedSettingsHeader,
              focusedIndex === 7 && styles.focusedButton
            ]}
            onPress={() => setShowAdvancedSettings(!showAdvancedSettings)}
            accessible={true}
            accessibilityLabel="Paramètres avancés"
            accessibilityRole="button"
            onFocus={() => setFocusedIndex(7)}
          >
            <Text style={styles.sectionTitle}>Paramètres avancés</Text>
            <Text style={styles.chevron}>{showAdvancedSettings ? '▼' : '▶'}</Text>
          </TouchableOpacity>
          
          {showAdvancedSettings && (
            <View style={styles.advancedSettingsContainer}>
              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Zap size={20} color={remoteControlEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingLabel}>Contrôle à distance</Text>
                    <Text style={styles.settingDescription}>
                      Permet de contrôler l'appareil depuis la plateforme web
                    </Text>
                  </View>
                </View>
                <Switch
                  value={remoteControlEnabled}
                  onValueChange={setRemoteControlEnabled}
                  trackColor={{ false: '#6b7280', true: '#10b981' }}
                  thumbColor={remoteControlEnabled ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#6b7280"
                  style={[
                    styles.settingSwitch,
                    focusedIndex === 8 && styles.focusedSwitch
                  ]}
                  onFocus={() => setFocusedIndex(8)}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Activity size={20} color={statusReportingEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingLabel}>Rapport de statut</Text>
                    <Text style={styles.settingDescription}>
                      Envoie périodiquement le statut de l'appareil au serveur
                    </Text>
                  </View>
                </View>
                <Switch
                  value={statusReportingEnabled}
                  onValueChange={setStatusReportingEnabled}
                  trackColor={{ false: '#6b7280', true: '#10b981' }}
                  thumbColor={statusReportingEnabled ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#6b7280"
                  style={[
                    styles.settingSwitch,
                    focusedIndex === 9 && styles.focusedSwitch
                  ]}
                  onFocus={() => setFocusedIndex(9)}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <RefreshCw size={20} color={memoryOptimizationEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingLabel}>Optimisation mémoire</Text>
                    <Text style={styles.settingDescription}>
                      Optimise l'utilisation de la mémoire pour les longues présentations
                    </Text>
                  </View>
                </View>
                <Switch
                  value={memoryOptimizationEnabled}
                  onValueChange={setMemoryOptimizationEnabled}
                  trackColor={{ false: '#6b7280', true: '#10b981' }}
                  thumbColor={memoryOptimizationEnabled ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#6b7280"
                  style={[
                    styles.settingSwitch,
                    focusedIndex === 10 && styles.focusedSwitch
                  ]}
                  onFocus={() => setFocusedIndex(10)}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Moon size={20} color={keepAwakeEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingLabel}>Mode anti-veille</Text>
                    <Text style={styles.settingDescription}>
                      Empêche l'écran de s'éteindre automatiquement
                    </Text>
                  </View>
                </View>
                <Switch
                  value={keepAwakeEnabled}
                  onValueChange={toggleKeepAwake}
                  trackColor={{ false: '#6b7280', true: '#10b981' }}
                  thumbColor={keepAwakeEnabled ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#6b7280"
                  style={[
                    styles.settingSwitch,
                    focusedIndex === 11 && styles.focusedSwitch
                  ]}
                  onFocus={() => setFocusedIndex(11)}
                />
              </View>
              
              <View style={styles.settingRow}>
                <View style={styles.settingLabelContainer}>
                  <Radio size={20} color={webSocketEnabled ? "#10b981" : "#6b7280"} />
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingLabel}>WebSocket</Text>
                    <Text style={styles.settingDescription}>
                      Permet le contrôle en temps réel et les notifications push
                    </Text>
                  </View>
                </View>
                <Switch
                  value={webSocketEnabled}
                  onValueChange={toggleWebSocket}
                  trackColor={{ false: '#6b7280', true: '#10b981' }}
                  thumbColor={webSocketEnabled ? '#ffffff' : '#f4f3f4'}
                  ios_backgroundColor="#6b7280"
                  style={[
                    styles.settingSwitch,
                    focusedIndex === 12 && styles.focusedSwitch
                  ]}
                  onFocus={() => setFocusedIndex(12)}
                />
              </View>
              
              <TouchableOpacity
                style={styles.saveAdvancedButton}
                onPress={saveAdvancedSettings}
              >
                <Check size={16} color="#ffffff" />
                <Text style={styles.saveAdvancedButtonText}>
                  Sauvegarder les paramètres avancés
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>Guide de configuration OVH</Text>
          <Text style={styles.helpText}>
            <Text style={styles.helpBold}>1. URL du serveur OVH :</Text>{`\n`}
            Entrez l'URL complète de votre API hébergée chez OVH{`\n`}
            Exemple: http://votre-domaine.fr/mods/livetv/api{`\n\n`}
            
            <Text style={styles.helpBold}>2. Problèmes de connexion OVH :</Text>{`\n`}
            • Vérifiez que votre serveur OVH autorise les requêtes HTTP{`\n`}
            • Assurez-vous que le pare-feu OVH n'est pas trop restrictif{`\n`}
            • Vérifiez que PHP est correctement configuré sur OVH{`\n\n`}
            
            <Text style={styles.helpBold}>3. Certificats SSL :</Text>{`\n`}
            • Si vous utilisez HTTPS, assurez-vous que votre certificat est valide{`\n`}
            • Pour les tests, utilisez HTTP plutôt que HTTPS{`\n`}
            • L'application est configurée pour accepter les connexions non sécurisées{`\n\n`}
            
            <Text style={styles.helpBold}>4. Mode anti-veille :</Text>{`\n`}
            • Activé par défaut pour empêcher l'écran de s\'éteindre{`\n`}
            • Fonctionne même en arrière-plan{`\n`}
            • Peut être désactivé dans les paramètres avancés{`\n\n`}
            
            <Text style={styles.helpBold}>5. WebSocket :</Text>{`\n`}
            • Permet le contrôle en temps réel de l'appareil{`\n`}
            • Nécessite un serveur WebSocket configuré{`\n`}
            • Réduit la latence des commandes à distance{`\n\n`}
            
            <Text style={styles.helpBold}>6. En cas de problème avec OVH :</Text>{`\n`}
            • Vérifiez les logs PHP sur votre hébergement OVH{`\n`}
            • Testez l'URL dans un navigateur web{`\n`}
            • Assurez-vous que les fichiers PHP ont les bonnes permissions{`\n`}
            • Vérifiez la configuration .htaccess si vous en utilisez un
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  headerGradient: {
    width: 80,
    height: 80,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 2,
    borderColor: '#374151',
    marginBottom: 8,
  },
  focusedInput: {
    borderColor: '#3b82f6',
    borderWidth: 4,
    backgroundColor: '#1e293b',
    transform: [{ scale: 1.02 }],
    elevation: 8,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  inputHint: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  deviceStatusContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  webSocketStatusContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    marginLeft: 12,
  },
  refreshStatusButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  refreshStatusText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  testButton: {
    backgroundColor: '#3b82f6',
  },
  saveButton: {
    backgroundColor: '#10b981',
  },
  registerButton: {
    backgroundColor: '#8b5cf6',
    flex: 'none',
    width: '100%',
  },
  actionButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#374151',
  },
  resetButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  focusedButton: {
    borderWidth: 4,
    borderColor: '#3b82f6',
    transform: [{ scale: 1.05 }],
    elevation: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  registerHint: {
    fontSize: 12,
    color: '#9ca3af',
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 16,
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  infoContent: {
    marginLeft: 12,
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  advancedSettingsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 16,
  },
  chevron: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  advancedSettingsContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  settingLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 12,
    color: '#9ca3af',
  },
  settingSwitch: {
    marginLeft: 8,
  },
  focusedSwitch: {
    transform: [{ scale: 1.1 }],
  },
  saveAdvancedButton: {
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  saveAdvancedButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  helpSection: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 12,
  },
  helpText: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 22,
  },
  helpBold: {
    fontWeight: 'bold',
    color: '#ffffff',
  },
  errorContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: 4,
  },
  errorMessage: {
    fontSize: 12,
    color: '#ef4444',
    lineHeight: 18,
  },
});
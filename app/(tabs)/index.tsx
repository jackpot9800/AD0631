import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Monitor, Play, Star, Clock, WifiOff, CircleAlert as AlertCircle, RefreshCw, Settings, Radio } from 'lucide-react-native';
import { apiService, Presentation } from '@/services/ApiService';
import { statusService } from '@/services/StatusService';
import { initWebSocketService, getWebSocketService } from '@/services/WebSocketService';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Définition des types
interface AssignedPresentation {
  presentation_id: number;
  presentation_name: string;
  presentation_description: string;
  auto_play: boolean;
  loop_mode: boolean;
}

interface DefaultPresentation {
  presentation_id: number;
  presentation_name: string;
  presentation_description: string;
  slide_count: number;
  is_default: boolean;
}

export default function HomeScreen() {
  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'not_configured' | 'connecting' | 'connected' | 'error'>('connecting');
  const [assignedPresentation, setAssignedPresentation] = useState<AssignedPresentation | null>(null);
  const [defaultPresentation, setDefaultPresentation] = useState<DefaultPresentation | null>(null);
  const [recentPresentations, setRecentPresentations] = useState<Presentation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [webSocketStatus, setWebSocketStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  useEffect(() => {
    const initializeApp = async () => {
      setLoading(true);
      
      // Initialiser le service API
      await apiService.initialize();
      
      // Vérifier si l'URL du serveur est configurée
      const serverUrl = apiService.getServerUrl();
      if (!serverUrl) {
        setConnectionStatus('not_configured');
        setLoading(false);
        return;
      }
      
      await checkConnection();
      await loadAssignedPresentation();
      await loadDefaultPresentation();
      await loadRecentPresentations();
      
      // Initialiser le service WebSocket si activé
      const webSocketEnabled = await AsyncStorage.getItem('websocket_enabled');
      if (webSocketEnabled !== 'false') {
        try {
          setWebSocketStatus('connecting');
          await initWebSocketService();
          setWebSocketStatus('connected');
        } catch (error) {
          console.error('Error initializing WebSocket service:', error);
          setWebSocketStatus('disconnected');
        }
      }
      
      setLoading(false);
    };

    initializeApp();
    
    // Démarrer la vérification des présentations assignées
    apiService.startAssignmentCheck(handleAssignedPresentation);
    apiService.startDefaultPresentationCheck(handleDefaultPresentation);
    
    return () => {
      // Arrêter la vérification des présentations assignées
      apiService.stopAssignmentCheck();
      apiService.stopDefaultPresentationCheck();
    };
  }, []);
  
  // Vérifier périodiquement le statut WebSocket
  useEffect(() => {
    const checkWebSocketStatus = setInterval(() => {
      const wsService = getWebSocketService();
      if (wsService) {
        setWebSocketStatus(wsService.isConnectedToServer() ? 'connected' : 'disconnected');
      }
    }, 5000);
    
    return () => clearInterval(checkWebSocketStatus);
  }, []);

  const checkConnection = async () => {
    try {
      const connected = await apiService.testConnection();
      setConnectionStatus(connected ? 'connected' : 'error');
      
      if (connected && !apiService.isDeviceRegistered()) {
        // Enregistrer l'appareil automatiquement
        try {
          await apiService.registerDevice();
        } catch (error) {
          console.error('Auto-registration failed:', error);
        }
      }
    } catch (error) {
      console.error('Connection check failed:', error);
      setConnectionStatus('error');
      setError(error instanceof Error ? error.message : 'Erreur de connexion inconnue');
    }
  };

  const loadAssignedPresentation = async () => {
    try {
      const presentation = await apiService.getLocalAssignedPresentation();
      setAssignedPresentation(presentation);
    } catch (error) {
      console.error('Error loading assigned presentation:', error);
    }
  };

  const loadDefaultPresentation = async () => {
    try {
      const presentation = await apiService.getLocalDefaultPresentation();
      setDefaultPresentation(presentation);
    } catch (error) {
      console.error('Error loading default presentation:', error);
    }
  };

  const loadRecentPresentations = async () => {
    try {
      const presentations = await apiService.getPresentations();
      setRecentPresentations(presentations.slice(0, 5));
    } catch (error) {
      console.error('Error loading recent presentations:', error);
    }
  };

  const handleAssignedPresentation = (presentation: AssignedPresentation) => {
    setAssignedPresentation(presentation);
    
    // Si auto_play est activé, lancer automatiquement la présentation
    if (presentation.auto_play) {
      router.push({
        pathname: `/presentation/${presentation.presentation_id}`,
        params: {
          auto_play: 'true',
          loop_mode: presentation.loop_mode ? 'true' : 'false',
          assigned: 'true'
        }
      });
    }
  };

  const handleDefaultPresentation = (presentation: DefaultPresentation) => {
    setDefaultPresentation(presentation);
  };

  const playAssignedPresentation = () => {
    if (assignedPresentation) {
      router.push({
        pathname: `/presentation/${assignedPresentation.presentation_id}`,
        params: {
          auto_play: 'true',
          loop_mode: assignedPresentation.loop_mode ? 'true' : 'false',
          assigned: 'true'
        }
      });
    }
  };

  const playDefaultPresentation = () => {
    if (defaultPresentation) {
      router.push({
        pathname: `/presentation/${defaultPresentation.presentation_id}`,
        params: {
          auto_play: 'true',
          loop_mode: 'true',
          assigned: 'false'
        }
      });
    }
  };

  const playPresentation = (presentation: Presentation) => {
    router.push({
      pathname: `/presentation/${presentation.id}`,
      params: {
        auto_play: 'true',
        loop_mode: 'true',
        assigned: 'false'
      }
    });
  };

  const goToSettings = () => {
    router.push('/settings');
  };

  const refreshData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await checkConnection();
      await loadAssignedPresentation();
      await loadDefaultPresentation();
      await loadRecentPresentations();
      
      // Vérifier le statut WebSocket
      const wsService = getWebSocketService();
      if (wsService) {
        setWebSocketStatus(wsService.isConnectedToServer() ? 'connected' : 'disconnected');
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
      setError(error instanceof Error ? error.message : 'Erreur lors de l\'actualisation');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  if (connectionStatus === 'not_configured') {
    return (
      <View style={styles.container}>
        <View style={styles.notConfiguredContainer}>
          <WifiOff size={64} color="#ef4444" />
          <Text style={styles.notConfiguredTitle}>Serveur non configuré</Text>
          <Text style={styles.notConfiguredText}>
            Vous devez configurer l'URL du serveur pour utiliser l'application.
          </Text>
          <TouchableOpacity style={styles.configButton} onPress={goToSettings}>
            <Text style={styles.configButtonText}>Configurer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (connectionStatus === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <AlertCircle size={64} color="#ef4444" />
          <Text style={styles.errorTitle}>Erreur de connexion</Text>
          <Text style={styles.errorText}>
            {error || "Impossible de se connecter au serveur. Vérifiez l'URL et la disponibilité du serveur."}
          </Text>
          <View style={styles.errorButtonsContainer}>
            <TouchableOpacity style={styles.errorButton} onPress={refreshData}>
              <RefreshCw size={20} color="#ffffff" />
              <Text style={styles.errorButtonText}>Réessayer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.errorButton, styles.settingsButton]} onPress={goToSettings}>
              <Settings size={20} color="#ffffff" />
              <Text style={styles.errorButtonText}>Paramètres</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.title}>Kiosque de Présentations</Text>
          <Text style={styles.subtitle}>Fire TV Enhanced</Text>
          
          <View style={styles.statusContainer}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: '#10b981' }]} />
              <Text style={styles.statusText}>Connecté au serveur</Text>
            </View>
            
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: webSocketStatus === 'connected' ? '#10b981' : '#6b7280' }]} />
              <Text style={styles.statusText}>
                WebSocket {webSocketStatus === 'connected' ? 'connecté' : 'déconnecté'}
              </Text>
            </View>
          </View>
        </View>

        {assignedPresentation && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Présentation assignée</Text>
              <View style={styles.assignedBadge}>
                <Star size={12} color="#ffffff" />
                <Text style={styles.assignedBadgeText}>Assignée</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.assignedPresentationCard}
              onPress={playAssignedPresentation}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#4f46e5', '#7c3aed']}
                style={styles.assignedCardGradient}
              >
                <View style={styles.assignedCardContent}>
                  <View style={styles.assignedCardInfo}>
                    <Text style={styles.assignedCardTitle}>{assignedPresentation.presentation_name}</Text>
                    <Text style={styles.assignedCardDescription} numberOfLines={2}>
                      {assignedPresentation.presentation_description}
                    </Text>
                    
                    <View style={styles.assignedCardMeta}>
                      {assignedPresentation.auto_play && (
                        <View style={styles.metaTag}>
                          <Play size={12} color="#ffffff" />
                          <Text style={styles.metaTagText}>Auto-play</Text>
                        </View>
                      )}
                      
                      {assignedPresentation.loop_mode && (
                        <View style={styles.metaTag}>
                          <RefreshCw size={12} color="#ffffff" />
                          <Text style={styles.metaTagText}>Boucle</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  <View style={styles.assignedCardAction}>
                    <View style={styles.playButton}>
                      <Play size={24} color="#ffffff" fill="#ffffff" />
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {defaultPresentation && !assignedPresentation && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Présentation par défaut</Text>
              <View style={styles.defaultBadge}>
                <Star size={12} color="#ffffff" />
                <Text style={styles.defaultBadgeText}>Par défaut</Text>
              </View>
            </View>
            
            <TouchableOpacity
              style={styles.defaultPresentationCard}
              onPress={playDefaultPresentation}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#0ea5e9', '#0284c7']}
                style={styles.defaultCardGradient}
              >
                <View style={styles.defaultCardContent}>
                  <View style={styles.defaultCardInfo}>
                    <Text style={styles.defaultCardTitle}>{defaultPresentation.presentation_name}</Text>
                    <Text style={styles.defaultCardDescription} numberOfLines={2}>
                      {defaultPresentation.presentation_description}
                    </Text>
                    
                    <View style={styles.defaultCardMeta}>
                      <View style={styles.metaItem}>
                        <Monitor size={14} color="#ffffff" />
                        <Text style={styles.metaText}>
                          {defaultPresentation.slide_count} slide{defaultPresentation.slide_count > 1 ? 's' : ''}
                        </Text>
                      </View>
                    </View>
                  </View>
                  
                  <View style={styles.defaultCardAction}>
                    <View style={styles.playButton}>
                      <Play size={24} color="#ffffff" fill="#ffffff" />
                    </View>
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Présentations récentes</Text>
          
          {recentPresentations.length > 0 ? (
            <View style={styles.presentationsGrid}>
              {recentPresentations.map((presentation) => (
                <TouchableOpacity
                  key={presentation.id}
                  style={styles.presentationCard}
                  onPress={() => playPresentation(presentation)}
                  activeOpacity={0.8}
                >
                  <View style={styles.presentationCardContent}>
                    <View style={styles.presentationIconContainer}>
                      <LinearGradient
                        colors={['#4f46e5', '#7c3aed']}
                        style={styles.presentationIcon}
                      >
                        <Monitor size={20} color="#ffffff" />
                      </LinearGradient>
                    </View>
                    
                    <View style={styles.presentationInfo}>
                      <Text style={styles.presentationTitle} numberOfLines={1}>
                        {presentation.name}
                      </Text>
                      
                      <View style={styles.presentationMeta}>
                        <View style={styles.metaItem}>
                          <Monitor size={12} color="#9ca3af" />
                          <Text style={styles.metaText}>
                            {presentation.slide_count} slide{presentation.slide_count > 1 ? 's' : ''}
                          </Text>
                        </View>
                        
                        <View style={styles.metaItem}>
                          <Clock size={12} color="#9ca3af" />
                          <Text style={styles.metaText}>
                            {new Date(presentation.created_at).toLocaleDateString()}
                          </Text>
                        </View>
                      </View>
                    </View>
                    
                    <View style={styles.presentationAction}>
                      <Play size={16} color="#3b82f6" />
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Monitor size={48} color="#6b7280" />
              <Text style={styles.emptyTitle}>Aucune présentation récente</Text>
              <Text style={styles.emptyMessage}>
                Les présentations que vous visualisez apparaîtront ici.
              </Text>
            </View>
          )}
        </View>
        
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contrôle à distance</Text>
          
          <View style={styles.remoteControlCard}>
            <View style={styles.remoteControlHeader}>
              <Radio size={20} color={webSocketStatus === 'connected' ? "#10b981" : "#6b7280"} />
              <Text style={styles.remoteControlTitle}>
                WebSocket {webSocketStatus === 'connected' ? 'connecté' : 'déconnecté'}
              </Text>
            </View>
            
            <Text style={styles.remoteControlDescription}>
              {webSocketStatus === 'connected' 
                ? "Votre appareil est connecté au serveur WebSocket et peut recevoir des commandes en temps réel."
                : "Votre appareil n'est pas connecté au serveur WebSocket. Les commandes à distance utiliseront le mode HTTP."}
            </Text>
            
            <TouchableOpacity 
              style={[
                styles.remoteControlButton,
                webSocketStatus === 'connected' ? styles.remoteControlButtonConnected : styles.remoteControlButtonDisconnected
              ]}
              onPress={async () => {
                if (webSocketStatus !== 'connected') {
                  try {
                    setWebSocketStatus('connecting');
                    await initWebSocketService();
                    setWebSocketStatus('connected');
                    Alert.alert(
                      'WebSocket connecté',
                      'Connexion au serveur WebSocket établie avec succès.',
                      [{ text: 'OK' }]
                    );
                  } catch (error) {
                    console.error('Error connecting to WebSocket server:', error);
                    setWebSocketStatus('disconnected');
                    Alert.alert(
                      'Erreur de connexion',
                      'Impossible de se connecter au serveur WebSocket.',
                      [{ text: 'OK' }]
                    );
                  }
                } else {
                  const wsService = getWebSocketService();
                  if (wsService) {
                    wsService.disconnect();
                    setWebSocketStatus('disconnected');
                    Alert.alert(
                      'WebSocket déconnecté',
                      'Déconnexion du serveur WebSocket effectuée.',
                      [{ text: 'OK' }]
                    );
                  }
                }
              }}
            >
              <Text style={styles.remoteControlButtonText}>
                {webSocketStatus === 'connected' 
                  ? 'Déconnecter' 
                  : (webSocketStatus === 'connecting' ? 'Connexion...' : 'Connecter')}
              </Text>
            </TouchableOpacity>
          </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#ffffff',
    marginTop: 16,
    fontSize: 16,
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 16,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  assignedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#4f46e5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
  },
  assignedBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0ea5e9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 12,
  },
  defaultBadgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  assignedPresentationCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  assignedCardGradient: {
    borderRadius: 12,
  },
  assignedCardContent: {
    flexDirection: 'row',
    padding: 16,
  },
  assignedCardInfo: {
    flex: 1,
  },
  assignedCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  assignedCardDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 12,
  },
  assignedCardMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  metaTagText: {
    color: '#ffffff',
    fontSize: 12,
    marginLeft: 4,
  },
  assignedCardAction: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  defaultPresentationCard: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  defaultCardGradient: {
    borderRadius: 12,
  },
  defaultCardContent: {
    flexDirection: 'row',
    padding: 16,
  },
  defaultCardInfo: {
    flex: 1,
  },
  defaultCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  defaultCardDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    marginBottom: 12,
  },
  defaultCardMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  defaultCardAction: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentationsGrid: {
    gap: 12,
  },
  presentationCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 8,
  },
  presentationCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  presentationIconContainer: {
    marginRight: 12,
  },
  presentationIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentationInfo: {
    flex: 1,
  },
  presentationTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  presentationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#9ca3af',
    marginLeft: 4,
  },
  presentationAction: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 16,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  notConfiguredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  notConfiguredTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  notConfiguredText: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  configButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  configButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 24,
  },
  errorButtonsContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  errorButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsButton: {
    backgroundColor: '#6b7280',
  },
  errorButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  remoteControlCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
  },
  remoteControlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  remoteControlTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    marginLeft: 8,
  },
  remoteControlDescription: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
    lineHeight: 20,
  },
  remoteControlButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  remoteControlButtonConnected: {
    backgroundColor: '#ef4444',
  },
  remoteControlButtonDisconnected: {
    backgroundColor: '#10b981',
  },
  remoteControlButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
});
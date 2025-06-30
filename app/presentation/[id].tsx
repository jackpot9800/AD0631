import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Dimensions,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Monitor, 
  Clock, 
  CircleAlert as AlertCircle, 
  RefreshCw, 
  RotateCcw, 
  Repeat 
} from 'lucide-react-native';
import { apiService, PresentationDetails, Slide } from '@/services/ApiService';
import { statusService, RemoteCommand } from '@/services/StatusService';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

const { width, height } = Dimensions.get('window');

// Import conditionnel de TVEventHandler avec gestion d'erreur robuste
let TVEventHandler: any = null;
if (Platform.OS === 'android' || Platform.OS === 'ios') {
  try {
    TVEventHandler = require('react-native').TVEventHandler;
  } catch (error) {
    console.log('TVEventHandler not available on this platform');
  }
}

export default function PresentationScreen() {
  const { id, auto_play, loop_mode, assigned, restart, remote_command } = useLocalSearchParams();
  const [presentation, setPresentation] = useState<PresentationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [imageLoadError, setImageLoadError] = useState<{[key: number]: boolean}>({});
  const [loopCount, setLoopCount] = useState(0);
  const [focusedControlIndex, setFocusedControlIndex] = useState(1);
  const [memoryOptimization, setMemoryOptimization] = useState(false);
  
  // Refs pour la gestion des timers et événements
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tvEventHandlerRef = useRef<any>(null);
  const imagePreloadRef = useRef<{[key: number]: boolean}>({});
  const lastSlideChangeRef = useRef<number>(0);
  const performanceMonitorRef = useRef<NodeJS.Timeout | null>(null);
  const slideChangeInProgressRef = useRef<boolean>(false);
  const keepScreenAwakeRef = useRef<NodeJS.Timeout | null>(null);

  // Nettoyage complet des ressources
  const cleanupResources = useCallback(() => {
    console.log('=== CLEANING UP RESOURCES ===');
    
    // Arrêter tous les timers
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
    
    if (performanceMonitorRef.current) {
      clearInterval(performanceMonitorRef.current);
      performanceMonitorRef.current = null;
    }
    
    if (keepScreenAwakeRef.current) {
      clearInterval(keepScreenAwakeRef.current);
      keepScreenAwakeRef.current = null;
    }
    
    // Désactiver le gestionnaire TV
    if (tvEventHandlerRef.current) {
      try {
        tvEventHandlerRef.current.disable();
        tvEventHandlerRef.current = null;
      } catch (error) {
        console.log('Error disabling TV event handler:', error);
      }
    }
    
    // Nettoyer les erreurs d'images
    setImageLoadError({});
    imagePreloadRef.current = {};
    slideChangeInProgressRef.current = false;
  }, []);

  // Monitoring des performances pour détecter les fuites mémoire
  const startPerformanceMonitoring = useCallback(() => {
    if (performanceMonitorRef.current) return;
    
    performanceMonitorRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceLastChange = now - lastSlideChangeRef.current;
      
      // Si aucun changement de slide depuis plus de 2 minutes en mode boucle
      if (isLooping && isPlaying && timeSinceLastChange > 120000) {
        console.warn('=== POTENTIAL MEMORY LEAK DETECTED ===');
        console.warn('No slide change for 2 minutes, restarting presentation');
        restartPresentation();
      }
      
      // Activer l'optimisation mémoire après 10 boucles
      if (loopCount >= 10 && !memoryOptimization) {
        console.log('=== ENABLING MEMORY OPTIMIZATION ===');
        setMemoryOptimization(true);
      }
    }, 30000); // Vérifier toutes les 30 secondes
  }, [isLooping, isPlaying, loopCount, memoryOptimization]);

  // Fonction pour maintenir l'écran allumé
  const startKeepAwakeTimer = useCallback(() => {
    if (keepScreenAwakeRef.current) {
      clearInterval(keepScreenAwakeRef.current);
    }
    
    // Réactiver le mode anti-veille toutes les 30 secondes pour s'assurer que l'écran reste allumé
    keepScreenAwakeRef.current = setInterval(() => {
      if (Platform.OS !== 'web') {
        console.log('Refreshing keep awake mode to prevent screen timeout');
        // Réactiver le mode anti-veille
        activateKeepAwake();
      }
    }, 30000);
  }, []);

  useEffect(() => {
    // Activer le mode anti-veille spécifiquement pour cette page
    if (Platform.OS !== 'web') {
      console.log('Activating keep awake mode for presentation screen');
      activateKeepAwake();
      startKeepAwakeTimer();
    }
    
    loadPresentation();
    
    // Configurer selon les paramètres d'assignation
    if (auto_play === 'true') {
      console.log('Auto-play enabled from assignment');
    }
    if (loop_mode === 'true') {
      console.log('Loop mode enabled from assignment');
      setIsLooping(true);
    }

    // Configuration Fire TV avec gestion d'erreur
    if (Platform.OS === 'android' && TVEventHandler) {
      setupFireTVControls();
    }
    
    // Démarrer le monitoring des performances
    startPerformanceMonitoring();
    
    // Configurer le callback pour les commandes à distance
    statusService.setOnRemoteCommand(handleRemoteCommand);
    
    return () => {
      cleanupResources();
      
      // Désactiver le mode anti-veille lors du démontage du composant
      if (Platform.OS !== 'web') {
        console.log('Deactivating keep awake mode when leaving presentation screen');
        deactivateKeepAwake();
      }
    };
  }, []);

  // Gestion des commandes à distance
  const handleRemoteCommand = useCallback((command: RemoteCommand) => {
    console.log('=== HANDLING REMOTE COMMAND IN PRESENTATION ===', command);
    
    switch (command.command) {
      case 'play':
        setIsPlaying(true);
        setShowControls(true);
        break;
        
      case 'pause':
        setIsPlaying(false);
        setShowControls(true);
        break;
        
      case 'stop':
        setIsPlaying(false);
        router.back();
        break;
        
      case 'restart':
        restartPresentation();
        break;
        
      case 'next_slide':
        nextSlide();
        break;
        
      case 'prev_slide':
        previousSlide();
        break;
        
      case 'goto_slide':
        if (command.parameters?.slide_index !== undefined) {
          goToSlide(command.parameters.slide_index);
        }
        break;
    }
  }, []);

  // Configuration des contrôles Fire TV optimisée
  const setupFireTVControls = useCallback(() => {
    if (!TVEventHandler || tvEventHandlerRef.current) return;

    try {
      tvEventHandlerRef.current = new TVEventHandler();
      tvEventHandlerRef.current.enable(null, (cmp: any, evt: any) => {
        if (!evt) return;

        console.log('Fire TV Event:', evt.eventType);
        
        // Afficher les contrôles lors de toute interaction
        setShowControls(true);

        switch (evt.eventType) {
          case 'right':
            handleNavigateRight();
            break;
          case 'left':
            handleNavigateLeft();
            break;
          case 'up':
            handleNavigateUp();
            break;
          case 'down':
            handleNavigateDown();
            break;
          case 'select':
          case 'playPause':
            handleSelectAction();
            break;
          case 'rewind':
            previousSlide();
            break;
          case 'fastForward':
            nextSlide();
            break;
          case 'menu':
            toggleControls();
            break;
          case 'back':
            // Confirmation avant de quitter en mode boucle
            if (isLooping && isPlaying) {
              Alert.alert(
                'Quitter la présentation',
                'La présentation est en cours de lecture en boucle. Voulez-vous vraiment quitter ?',
                [
                  { text: 'Continuer', style: 'cancel' },
                  { text: 'Quitter', onPress: () => router.back() }
                ]
              );
            } else {
              router.back();
            }
            break;
        }
      });
    } catch (error) {
      console.log('TVEventHandler setup failed:', error);
    }
  }, [isLooping, isPlaying]);

  // Navigation Fire TV optimisée
  const handleNavigateRight = useCallback(() => {
    const maxIndex = getMaxFocusIndex();
    if (focusedControlIndex < maxIndex) {
      setFocusedControlIndex(focusedControlIndex + 1);
    }
  }, [focusedControlIndex]);

  const handleNavigateLeft = useCallback(() => {
    if (focusedControlIndex > -1) {
      setFocusedControlIndex(focusedControlIndex - 1);
    }
  }, [focusedControlIndex]);

  const handleNavigateUp = useCallback(() => {
    if (focusedControlIndex >= 5) {
      setFocusedControlIndex(1);
    }
  }, [focusedControlIndex]);

  const handleNavigateDown = useCallback(() => {
    if (focusedControlIndex < 5 && presentation && presentation.slides.length > 0) {
      setFocusedControlIndex(5);
    }
  }, [focusedControlIndex, presentation]);

  const getMaxFocusIndex = useCallback(() => {
    const baseControls = 4;
    const slidesCount = presentation?.slides.length || 0;
    return baseControls + slidesCount;
  }, [presentation]);

  const handleSelectAction = useCallback(() => {
    switch (focusedControlIndex) {
      case -1:
        if (isLooping && isPlaying) {
          Alert.alert(
            'Quitter la présentation',
            'La présentation est en cours de lecture en boucle. Voulez-vous vraiment quitter ?',
            [
              { text: 'Continuer', style: 'cancel' },
              { text: 'Quitter', onPress: () => router.back() }
            ]
          );
        } else {
          router.back();
        }
        break;
      case 0:
        previousSlide();
        break;
      case 1:
        togglePlayPause();
        break;
      case 2:
        nextSlide();
        break;
      case 3:
        restartPresentation();
        break;
      case 4:
        toggleLoop();
        break;
      default:
        if (focusedControlIndex >= 5 && presentation) {
          const slideIndex = focusedControlIndex - 5;
          if (slideIndex < presentation.slides.length) {
            goToSlide(slideIndex);
          }
        }
        break;
    }
  }, [focusedControlIndex, isLooping, isPlaying, presentation]);

  // Démarrage automatique optimisé
  useEffect(() => {
    if (presentation && auto_play === 'true') {
      console.log('=== AUTO-STARTING PRESENTATION ===');
      const startTimer = setTimeout(() => {
        setIsPlaying(true);
        setShowControls(false);
      }, 1000);
      
      return () => clearTimeout(startTimer);
    }
  }, [presentation, auto_play]);

  // Gestion du timer de slide optimisée avec prévention des fuites mémoire
  useEffect(() => {
    console.log('=== TIMER EFFECT TRIGGERED ===');
    console.log('isPlaying:', isPlaying);
    console.log('currentSlideIndex:', currentSlideIndex);
    console.log('presentation slides:', presentation?.slides.length || 0);

    if (isPlaying && presentation && presentation.slides.length > 0) {
      startSlideTimer();
    } else {
      stopSlideTimer();
    }

    return () => {
      if (intervalRef.current) {
        console.log('=== CLEANING TIMER FROM EFFECT ===');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, currentSlideIndex, presentation]);

  // Auto-masquage des contrôles optimisé
  useEffect(() => {
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }

    if (showControls) {
      const hideDelay = assigned === 'true' ? 2000 : (isPlaying ? 3000 : 5000);
      
      console.log(`=== SETTING HIDE TIMEOUT: ${hideDelay}ms ===`);
      hideControlsTimeoutRef.current = setTimeout(() => {
        console.log('=== HIDING CONTROLS ===');
        setShowControls(false);
      }, hideDelay);
    }
    
    return () => {
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
        hideControlsTimeoutRef.current = null;
      }
    };
  }, [showControls, isPlaying, assigned]);

  // Mettre à jour le statut lors des changements
  useEffect(() => {
    if (presentation) {
      statusService.updatePresentationStatus(
        presentation.id,
        presentation.name || presentation.nom || 'Présentation',
        currentSlideIndex,
        presentation.slides.length,
        isLooping,
        auto_play === 'true'
      );
      
      statusService.updatePlaybackStatus(isPlaying ? 'playing' : 'paused');
    }
  }, [presentation, currentSlideIndex, isLooping, isPlaying, auto_play]);

  const loadPresentation = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log('Loading presentation with ID:', id);
      
      const data = await apiService.getPresentation(Number(id));
      console.log('Loaded presentation:', data);
      
      setPresentation(data);
      
      if (data.slides.length > 0) {
        setTimeRemaining(data.slides[0].duration * 1000);
        // Précharger les premières images
        preloadImages(data.slides.slice(0, 3));
      }
    } catch (error) {
      console.error('Error loading presentation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur inconnue';
      setError(errorMessage);
      statusService.reportError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Préchargement optimisé des images
  const preloadImages = useCallback((slides: Slide[]) => {
    if (memoryOptimization) {
      // En mode optimisation mémoire, ne précharger que l'image suivante
      return;
    }
    
    slides.forEach((slide, index) => {
      if (!imagePreloadRef.current[slide.id]) {
        Image.prefetch(slide.image_url).then(() => {
          imagePreloadRef.current[slide.id] = true;
        }).catch(() => {
          console.warn(`Failed to preload image for slide ${slide.id}`);
        });
      }
    });
  }, [memoryOptimization]);

  const stopSlideTimer = useCallback(() => {
    if (intervalRef.current) {
      console.log('=== STOPPING SLIDE TIMER ===');
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startSlideTimer = useCallback(() => {
    if (!presentation || presentation.slides.length === 0) {
      console.log('=== NO PRESENTATION OR SLIDES, NOT STARTING TIMER ===');
      return;
    }

    stopSlideTimer();

    const currentSlide = presentation.slides[currentSlideIndex];
    const slideDuration = currentSlide.duration * 1000;
    
    console.log(`=== STARTING NEW TIMER FOR SLIDE ${currentSlideIndex + 1} ===`);
    console.log(`Slide duration: ${currentSlide.duration}s (${slideDuration}ms)`);
    
    setTimeRemaining(slideDuration);
    lastSlideChangeRef.current = Date.now();

    intervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = prev - 100;
        
        if (newTime <= 0) {
          console.log(`=== TIMER FINISHED FOR SLIDE ${currentSlideIndex + 1} ===`);
          nextSlide();
          return 0;
        }
        
        return newTime;
      });
    }, 100);

    console.log('=== TIMER STARTED SUCCESSFULLY ===');
  }, [presentation, currentSlideIndex]);

  const togglePlayPause = useCallback(() => {
    console.log('=== TOGGLE PLAY/PAUSE ===');
    console.log('Current state:', isPlaying ? 'PLAYING' : 'PAUSED');
    
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);
    setShowControls(true);
  }, [isPlaying]);

  const toggleLoop = useCallback(() => {
    const newLoopState = !isLooping;
    setIsLooping(newLoopState);
    setShowControls(true);
    
    Alert.alert(
      'Mode boucle',
      newLoopState ? 'Mode boucle activé - La présentation se répétera automatiquement' : 'Mode boucle désactivé',
      [{ text: 'OK' }]
    );
  }, [isLooping]);

  const nextSlide = useCallback(() => {
    if (!presentation) return;
    
    console.log(`=== NEXT SLIDE LOGIC ===`);
    console.log(`Current: ${currentSlideIndex + 1}/${presentation.slides.length}`);
    console.log(`Is looping: ${isLooping}`);
    console.log(`Is playing: ${isPlaying}`);
    
    // Précharger l'image suivante si pas en mode optimisation mémoire
    if (!memoryOptimization && currentSlideIndex < presentation.slides.length - 2) {
      const nextSlideIndex = currentSlideIndex + 2;
      if (nextSlideIndex < presentation.slides.length) {
        preloadImages([presentation.slides[nextSlideIndex]]);
      }
    }
    
    if (currentSlideIndex < presentation.slides.length - 1) {
      const nextIndex = currentSlideIndex + 1;
      console.log(`Moving to slide ${nextIndex + 1}`);
      setCurrentSlideIndex(nextIndex);
      lastSlideChangeRef.current = Date.now();
    } else {
      console.log('End of presentation reached');
      
      if (isLooping) {
        console.log(`Loop ${loopCount + 1} completed, restarting...`);
        setCurrentSlideIndex(0);
        setLoopCount(prev => prev + 1);
        lastSlideChangeRef.current = Date.now();
        
        // Nettoyage périodique de la mémoire
        if (memoryOptimization && loopCount % 5 === 0) {
          console.log('=== PERFORMING MEMORY CLEANUP ===');
          setImageLoadError({});
          imagePreloadRef.current = {};
        }
      } else {
        console.log('Stopping playback, showing options');
        setIsPlaying(false);
        setCurrentSlideIndex(0);
        setShowControls(true);
        
        if (assigned === 'true') {
          Alert.alert(
            'Présentation terminée',
            'La présentation assignée est terminée. Elle va recommencer automatiquement.',
            [
              { text: 'Recommencer maintenant', onPress: () => { setIsPlaying(true); setIsLooping(true); } },
              { text: 'Arrêter', onPress: () => router.back() },
            ]
          );
          
          const restartTimer = setTimeout(() => {
            setIsLooping(true);
            setIsPlaying(true);
          }, 5000);
          
          return () => clearTimeout(restartTimer);
        } else {
          Alert.alert(
            'Présentation terminée',
            'La présentation est arrivée à sa fin.',
            [
              { text: 'Recommencer', onPress: () => setIsPlaying(true) },
              { text: 'Mode boucle', onPress: () => { setIsLooping(true); setIsPlaying(true); } },
              { text: 'Retour', onPress: () => router.back() },
            ]
          );
        }
      }
    }
  }, [presentation, currentSlideIndex, isLooping, isPlaying, assigned, loopCount, memoryOptimization]);

  const previousSlide = useCallback(() => {
    if (currentSlideIndex > 0) {
      console.log(`Moving to previous slide: ${currentSlideIndex}`);
      setCurrentSlideIndex(currentSlideIndex - 1);
      lastSlideChangeRef.current = Date.now();
    }
    setShowControls(true);
  }, [currentSlideIndex]);

  const goToSlide = useCallback((index: number) => {
    if (index >= 0 && index < (presentation?.slides.length || 0)) {
      console.log(`Jumping to slide ${index + 1}`);
      setCurrentSlideIndex(index);
      lastSlideChangeRef.current = Date.now();
      setShowControls(true);
    }
  }, [presentation]);

  const restartPresentation = useCallback(() => {
    console.log('=== RESTARTING PRESENTATION ===');
    setCurrentSlideIndex(0);
    setLoopCount(0);
    setIsPlaying(true);
    setShowControls(true);
    setMemoryOptimization(false);
    setImageLoadError({});
    imagePreloadRef.current = {};
    lastSlideChangeRef.current = Date.now();
    slideChangeInProgressRef.current = false;
  }, []);

  const toggleControls = useCallback(() => {
    console.log('=== TOGGLE CONTROLS ===');
    console.log('Current showControls:', showControls);
    setShowControls(!showControls);
  }, [showControls]);

  const formatTime = useCallback((milliseconds: number) => {
    const seconds = Math.ceil(milliseconds / 1000);
    return `${seconds}s`;
  }, []);

  const handleImageError = useCallback((slideId: number) => {
    console.error('Image load error for slide:', slideId);
    setImageLoadError(prev => ({ ...prev, [slideId]: true }));
  }, []);

  const retryLoadPresentation = useCallback(() => {
    setError(null);
    setImageLoadError({});
    imagePreloadRef.current = {};
    loadPresentation();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Chargement de la présentation...</Text>
        {assigned === 'true' && (
          <Text style={styles.assignedText}>Présentation assignée</Text>
        )}
        {auto_play === 'true' && (
          <Text style={styles.autoPlayText}>Lecture automatique activée</Text>
        )}
        {memoryOptimization && (
          <Text style={styles.optimizationText}>Mode optimisation mémoire</Text>
        )}
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <AlertCircle size={64} color="#ef4444" />
        <Text style={styles.errorTitle}>Erreur de chargement</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        
        <View style={styles.errorActions}>
          <TouchableOpacity 
            style={[
              styles.retryButton,
              focusedControlIndex === 0 && styles.focusedButton
            ]} 
            onPress={retryLoadPresentation}
            accessible={true}
            accessibilityLabel="Réessayer le chargement"
            accessibilityRole="button"
            onFocus={() => setFocusedControlIndex(0)}
          >
            <RefreshCw size={20} color="#ffffff" />
            <Text style={styles.retryButtonText}>Réessayer</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[
              styles.backButton,
              focusedControlIndex === 1 && styles.focusedButton
            ]} 
            onPress={() => router.back()}
            accessible={true}
            accessibilityLabel="Retour à la liste"
            accessibilityRole="button"
            onFocus={() => setFocusedControlIndex(1)}
          >
            <ArrowLeft size={20} color="#ffffff" />
            <Text style={styles.backButtonText}>Retour</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.debugContainer}>
          <Text style={styles.debugTitle}>Informations de debug:</Text>
          <Text style={styles.debugText}>ID: {id}</Text>
          <Text style={styles.debugText}>Serveur: {apiService.getServerUrl()}</Text>
          <Text style={styles.debugText}>Assignée: {assigned === 'true' ? 'Oui' : 'Non'}</Text>
          <Text style={styles.debugText}>Auto-play: {auto_play === 'true' ? 'Oui' : 'Non'}</Text>
          <Text style={styles.debugText}>Loop: {loop_mode === 'true' ? 'Oui' : 'Non'}</Text>
          <Text style={styles.debugText}>Erreur: {error}</Text>
        </ScrollView>
      </View>
    );
  }

  if (!presentation || presentation.slides.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Monitor size={64} color="#ef4444" />
        <Text style={styles.errorTitle}>Présentation vide</Text>
        <Text style={styles.errorMessage}>
          Cette présentation ne contient aucune slide valide.
        </Text>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
          accessible={true}
          accessibilityLabel="Retour à la liste"
          accessibilityRole="button"
        >
          <ArrowLeft size={20} color="#ffffff" />
          <Text style={styles.backButtonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentSlide = presentation.slides[currentSlideIndex];
  const progress = presentation.slides[currentSlideIndex].duration > 0 
    ? ((presentation.slides[currentSlideIndex].duration * 1000 - timeRemaining) / (presentation.slides[currentSlideIndex].duration * 1000)) * 100
    : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      
      <TouchableOpacity
        style={styles.slideContainer}
        onPress={toggleControls}
        activeOpacity={1}
        accessible={true}
        accessibilityLabel={`Slide ${currentSlideIndex + 1} sur ${presentation.slides.length}. Appuyez pour afficher les contrôles.`}
      >
        {imageLoadError[currentSlide.id] ? (
          <View style={styles.imageErrorContainer}>
            <AlertCircle size={48} color="#ef4444" />
            <Text style={styles.imageErrorText}>Impossible de charger l'image</Text>
            <Text style={styles.imageErrorUrl}>{currentSlide.image_url}</Text>
          </View>
        ) : (
          <Image
            source={{ uri: currentSlide.image_url }}
            style={styles.slideImage}
            resizeMode="contain"
            onError={() => handleImageError(currentSlide.id)}
            onLoad={() => console.log('Image loaded successfully:', currentSlide.image_url)}
          />
        )}
        
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${progress}%` }]} />
        </View>

        {isLooping && (
          <View style={styles.loopIndicator}>
            <Repeat size={16} color="#ffffff" />
            <Text style={styles.loopText}>
              BOUCLE {loopCount > 0 ? `(${loopCount})` : ''}
            </Text>
          </View>
        )}

        {assigned === 'true' && (
          <View style={styles.assignedIndicator}>
            <Monitor size={16} color="#ffffff" />
            <Text style={styles.assignedText}>ASSIGNÉE</Text>
          </View>
        )}

        {auto_play === 'true' && (
          <View style={styles.autoPlayIndicator}>
            <Play size={16} color="#ffffff" />
            <Text style={styles.autoPlayText}>AUTO</Text>
          </View>
        )}

        {memoryOptimization && (
          <View style={styles.optimizationIndicator}>
            <RefreshCw size={16} color="#ffffff" />
            <Text style={styles.optimizationText}>OPTIMISÉ</Text>
          </View>
        )}
      </TouchableOpacity>

      {showControls && (
        <View style={styles.controlsOverlay}>
          <LinearGradient
            colors={['rgba(0,0,0,0.8)', 'transparent', 'rgba(0,0,0,0.8)']}
            style={styles.controlsGradient}
          >
            <View style={styles.topControls}>
              <TouchableOpacity
                style={[
                  styles.backIconButton,
                  focusedControlIndex === -1 && styles.focusedControl
                ]}
                onPress={() => {
                  if (isLooping && isPlaying) {
                    Alert.alert(
                      'Quitter la présentation',
                      'La présentation est en cours de lecture en boucle. Voulez-vous vraiment quitter ?',
                      [
                        { text: 'Continuer', style: 'cancel' },
                        { text: 'Quitter', onPress: () => router.back() }
                      ]
                    );
                  } else {
                    router.back();
                  }
                }}
                accessible={true}
                accessibilityLabel="Retour à la liste des présentations"
                accessibilityRole="button"
                onFocus={() => setFocusedControlIndex(-1)}
              >
                <ArrowLeft size={24} color="#ffffff" />
              </TouchableOpacity>
              
              <View style={styles.presentationInfo}>
                <Text style={styles.presentationTitle} numberOfLines={1}>
                  {presentation.name}
                  {assigned === 'true' && ' (Assignée)'}
                  {memoryOptimization && ' (Optimisé)'}
                </Text>
                <Text style={styles.slideCounter}>
                  {currentSlideIndex + 1} / {presentation.slides.length}
                  {isLooping && loopCount > 0 && ` • Boucle ${loopCount}`}
                </Text>
              </View>

              <View style={styles.timeInfo}>
                <Clock size={16} color="#ffffff" />
                <Text style={styles.timeText}>
                  {formatTime(timeRemaining)}
                </Text>
              </View>
            </View>

            <View style={styles.bottomControls}>
              <View style={styles.controlButtons}>
                <TouchableOpacity
                  style={[
                    styles.controlButton, 
                    currentSlideIndex === 0 && styles.controlButtonDisabled,
                    focusedControlIndex === 0 && styles.focusedControl
                  ]}
                  onPress={previousSlide}
                  disabled={currentSlideIndex === 0}
                  accessible={true}
                  accessibilityLabel="Slide précédente"
                  accessibilityRole="button"
                  onFocus={() => setFocusedControlIndex(0)}
                >
                  <SkipBack size={24} color={currentSlideIndex === 0 ? "#6b7280" : "#ffffff"} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.controlButton, 
                    styles.playButton,
                    focusedControlIndex === 1 && styles.focusedControl
                  ]}
                  onPress={togglePlayPause}
                  accessible={true}
                  accessibilityLabel={isPlaying ? "Mettre en pause" : "Lancer la lecture"}
                  accessibilityRole="button"
                  onFocus={() => setFocusedControlIndex(1)}
                >
                  {isPlaying ? (
                    <Pause size={28} color="#ffffff" fill="#ffffff" />
                  ) : (
                    <Play size={28} color="#ffffff" fill="#ffffff" />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.controlButton, 
                    currentSlideIndex === presentation.slides.length - 1 && !isLooping && styles.controlButtonDisabled,
                    focusedControlIndex === 2 && styles.focusedControl
                  ]}
                  onPress={nextSlide}
                  disabled={currentSlideIndex === presentation.slides.length - 1 && !isLooping}
                  accessible={true}
                  accessibilityLabel="Slide suivante"
                  accessibilityRole="button"
                  onFocus={() => setFocusedControlIndex(2)}
                >
                  <SkipForward size={24} color={currentSlideIndex === presentation.slides.length - 1 && !isLooping ? "#6b7280" : "#ffffff"} />
                </TouchableOpacity>
              </View>

              <View style={styles.additionalControls}>
                <TouchableOpacity
                  style={[
                    styles.controlButton, 
                    styles.smallButton,
                    focusedControlIndex === 3 && styles.focusedControl
                  ]}
                  onPress={restartPresentation}
                  accessible={true}
                  accessibilityLabel="Recommencer la présentation"
                  accessibilityRole="button"
                  onFocus={() => setFocusedControlIndex(3)}
                >
                  <RotateCcw size={20} color="#ffffff" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.controlButton, 
                    styles.smallButton, 
                    isLooping && styles.activeButton,
                    focusedControlIndex === 4 && styles.focusedControl
                  ]}
                  onPress={toggleLoop}
                  accessible={true}
                  accessibilityLabel={isLooping ? "Désactiver le mode boucle" : "Activer le mode boucle"}
                  accessibilityRole="button"
                  onFocus={() => setFocusedControlIndex(4)}
                >
                  <Repeat size={20} color="#ffffff" />
                </TouchableOpacity>
              </View>

              <View style={styles.thumbnailContainer}>
                {presentation.slides.map((slide, index) => (
                  <TouchableOpacity
                    key={slide.id}
                    style={[
                      styles.thumbnail,
                      index === currentSlideIndex && styles.activeThumbnail,
                      focusedControlIndex === 5 + index && styles.focusedThumbnail,
                    ]}
                    onPress={() => goToSlide(index)}
                    accessible={true}
                    accessibilityLabel={`Aller à la slide ${index + 1}`}
                    accessibilityRole="button"
                    onFocus={() => setFocusedControlIndex(5 + index)}
                  >
                    <View style={styles.thumbnailNumber}>
                      <Text style={styles.thumbnailNumberText}>{index + 1}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#ffffff',
    fontSize: 16,
    marginTop: 16,
  },
  assignedText: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 8,
  },
  autoPlayText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  optimizationText: {
    color: '#8b5cf6',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 4,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    padding: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    backgroundColor: '#6b7280',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  debugContainer: {
    maxHeight: 200,
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 16,
  },
  debugTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  debugText: {
    color: '#9ca3af',
    fontSize: 12,
    marginBottom: 4,
  },
  slideContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideImage: {
    width: width,
    height: height,
  },
  imageErrorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  imageErrorText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  imageErrorUrl: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#3b82f6',
  },
  loopIndicator: {
    position: 'absolute',
    top: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  loopText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  assignedIndicator: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assignedText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  autoPlayIndicator: {
    position: 'absolute',
    top: 70,
    left: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autoPlayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  optimizationIndicator: {
    position: 'absolute',
    top: 120,
    left: 20,
    backgroundColor: 'rgba(139, 92, 246, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optimizationText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controlsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'box-none',
  },
  controlsGradient: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  backIconButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presentationInfo: {
    flex: 1,
    marginHorizontal: 16,
  },
  presentationTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  slideCounter: {
    color: '#9ca3af',
    fontSize: 14,
  },
  timeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timeText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
  bottomControls: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  controlButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  controlButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
  },
  controlButtonDisabled: {
    opacity: 0.5,
  },
  playButton: {
    backgroundColor: '#3b82f6',
    width: 60,
    height: 60,
    borderRadius: 30,
    marginHorizontal: 16,
  },
  additionalControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  smallButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginHorizontal: 0,
  },
  activeButton: {
    backgroundColor: '#10b981',
  },
  thumbnailContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  thumbnail: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  activeThumbnail: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.3)',
  },
  thumbnailNumber: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailNumberText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  focusedControl: {
    borderWidth: 4,
    borderColor: '#3b82f6',
    transform: [{ scale: 1.15 }],
    backgroundColor: 'rgba(59, 130, 246, 0.4)',
    elevation: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  focusedButton: {
    borderWidth: 4,
    borderColor: '#3b82f6',
    transform: [{ scale: 1.1 }],
    elevation: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  focusedThumbnail: {
    borderColor: '#f59e0b',
    borderWidth: 4,
    transform: [{ scale: 1.3 }],
    backgroundColor: 'rgba(245, 158, 11, 0.5)',
    elevation: 10,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
});
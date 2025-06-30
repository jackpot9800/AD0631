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
  const { id, auto_play, loop_mode, assigned, restart } = useLocalSearchParams();
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
  const slideTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Nettoyage complet des ressources
  const cleanupResources = useCallback(() => {
    console.log('=== CLEANING UP RESOURCES ===');
    
    // Arrêter tous les timers
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    if (slideTimerRef.current) {
      clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
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
    
    return () => {
      cleanupResources();
      
      // Désactiver le mode anti-veille lors du démontage du composant
      if (Platform.OS !== 'web') {
        console.log('Deactivating keep awake mode when leaving presentation screen');
        deactivateKeepAwake();
      }
    };
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
      if (slideTimerRef.current) {
        console.log('=== CLEANING TIMER FROM EFFECT ===');
        clearTimeout(slideTimerRef.current);
        slideTimerRef.current = null;
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
    if (slideTimerRef.current) {
      console.log('=== STOPPING SLIDE TIMER ===');
      clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
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

    slideTimerRef.current = setTimeout(() => {
      console.log(`=== TIMER FINISHED FOR SLIDE ${currentSlideIndex + 1} ===`);
      nextSlide();
    }, slideDuration);

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
          CetteCommençons par corriger les problèmes de démarrage et optimiser l'application :

<boltArtifact id="fix-app-stability" title="Correction des problèmes de stabilité et optimisations">
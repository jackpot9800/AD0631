import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { Platform } from 'react-native';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';

export default function RootLayout() {
  useFrameworkReady();

  // Activer le mode anti-veille pour empêcher l'écran de s'éteindre
  useEffect(() => {
    if (Platform.OS !== 'web') {
      console.log('Activating keep awake mode to prevent screen timeout');
      activateKeepAwake();
      
      // Nettoyer lors du démontage du composant
      return () => {
        console.log('Deactivating keep awake mode');
        deactivateKeepAwake();
      };
    }
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="presentation/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}
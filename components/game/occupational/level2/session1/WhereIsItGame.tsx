/**
 * OT Level 11 - Game 2: Where Is It? (Search & Touch)
 * 
 * Core Goal: Visual Scanning & Eye-Hand Coordination
 * - Screen shows mild background pattern
 * - One clear target (star / dot) appears
 * - Child must visually find and tap it
 * 
 * Skills trained:
 * - visual scanning
 * - attention focusing
 * - eye–hand alignment
 */

import { SparkleBurst } from '@/components/game/FX';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

const POP_URI = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const STAR_ICON = require('@/assets/icons/star.png');

const usePopSound = () => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    const { sound } = await ExpoAudio.Sound.createAsync({ uri: POP_URI }, { volume: 0.35, shouldPlay: false });
    soundRef.current = sound;
  }, []);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && (window as any).Audio) {
        const WebAudio = (window as any).Audio;
        const webSound = new WebAudio(POP_URI);
        webSound.volume = 0.3;
        webSound.play().catch(() => {});
        return;
      }
      await ensureSound();
      if (soundRef.current) {
        await soundRef.current.replayAsync();
      }
    } catch { }
  }, [ensureSound]);

  return play;
};

interface WhereIsItGameProps {
  onBack: () => void;
}

export const WhereIsItGame: React.FC<WhereIsItGameProps> = ({ onBack }) => {
  const [score, setScore] = useState(0);
  const [targetsLeft, setTargetsLeft] = useState(10);
  const [done, setDone] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const playPop = usePopSound();

  // Target size: large (20% of screen)
  const sizePct = 20;
  const radiusPct = sizePct / 2;

  const targetX = useSharedValue(50);
  const targetY = useSharedValue(50);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const spawnTarget = () => {
    const margin = radiusPct + 5;
    const x = margin + Math.random() * (100 - margin * 2);
    const y = margin + Math.random() * (100 - margin * 2);
    targetX.value = withTiming(x, { duration: 400 });
    targetY.value = withTiming(y, { duration: 400 });
    scale.value = withTiming(1, { duration: 300 });
    opacity.value = withTiming(1, { duration: 300 });
  };

  const handleTap = (event: any) => {
    // Only count tap if it's directly on the star (within the hit area)
    // The TouchableOpacity already handles this, but we ensure it's only the star
    Haptics.selectionAsync().catch(() => {});
    playPop();
    scale.value = withSequence(withTiming(1.2, { duration: 100 }), withTiming(0, { duration: 150 }));
    opacity.value = withTiming(0, { duration: 180 });
    setSparkleKey(Date.now());
    setScore((s) => s + 1);
    setTargetsLeft((t) => {
      const next = t - 1;
      if (next <= 0) {
        runOnJS(setDone)(true);
      } else {
        runOnJS(spawnTarget)();
      }
      return next;
    });
  };

  useEffect(() => {
    try {
      speakTTS('Find and tap the star!', 0.78 );
    } catch {}
    spawnTarget();
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const circleStyle = useAnimatedStyle(() => ({
    width: `${sizePct}%`,
    height: `${sizePct}%`,
    borderRadius: 999,
    left: `${targetX.value}%`,
    top: `${targetY.value}%`,
    transform: [
      { translateX: -(sizePct / 2) + '%' as any },
      { translateY: -(sizePct / 2) + '%' as any },
      { scale: scale.value }
    ],
    opacity: opacity.value,
  }));

  if (done) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient
          colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
          style={StyleSheet.absoluteFillObject}
        />
        <TouchableOpacity
          onPress={() => {
            try {
              stopTTS();
            } catch (e) {
              // Ignore errors
            }
            onBack();
          }}
          style={styles.backButton}
        >
          <LinearGradient
            colors={['#1E293B', '#0F172A']}
            style={styles.backButtonGradient}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </LinearGradient>
        </TouchableOpacity>
        <View style={styles.completion}>
          <Animated.Text 
            style={styles.bigEmoji}
            entering={FadeIn.duration(600).delay(200)}
          >
            🎉✨🌟
          </Animated.Text>
          <Text style={styles.title}>Great Searching! 🔍</Text>
          <Text style={styles.subtitle}>You found {score} targets! ⭐</Text>
          <View style={styles.statsBox}>
            <Text style={styles.statsText}>Perfect Score: {score}/10 ⭐</Text>
            <Text style={styles.badgeText}>🏅 Eye–Hand Explorer Badge</Text>
          </View>
          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={() => {
              setScore(0);
              setTargetsLeft(10);
              setDone(false);
              spawnTarget();
            }}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#22C55E', '#16A34A']}
              style={styles.primaryButtonGradient}
            >
              <Text style={styles.primaryButtonText}>🎮 Play Again</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.secondaryButton} 
            onPress={() => {
              stopAllSpeech();
              cleanupSounds();
              onBack();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>← Back to Sessions</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE', '#DBEAFE']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity 
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack();
        }} 
        style={styles.backButton}
      >
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backButtonGradient}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.hud}>
        <View style={styles.hudCard}>
          <LinearGradient
            colors={['#FEF3C7', '#FDE68A']}
            style={styles.hudCardGradient}
          >
            <View style={styles.rowCenter}>
              <Image source={STAR_ICON} style={styles.starIcon} />
              <Text style={styles.hudLabel}>Stars</Text>
            </View>
            <Text style={styles.hudValue}>{score}</Text>
          </LinearGradient>
        </View>
        <View style={styles.hudCard}>
          <LinearGradient
            colors={['#E0E7FF', '#C7D2FE']}
            style={styles.hudCardGradient}
          >
            <Text style={styles.hudLabel}>Targets Left</Text>
            <Text style={styles.hudValue}>{targetsLeft}</Text>
          </LinearGradient>
        </View>
      </View>

      <View style={styles.playArea}>
        <LinearGradient
          colors={['#F0FDF4', '#ECFDF5', '#D1FAE5']}
          style={StyleSheet.absoluteFillObject}
        />
        
        {/* Mild background pattern - not clickable */}
        <View style={styles.backgroundPattern} pointerEvents="none">
          {Array.from({ length: 12 }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.patternDot,
                {
                  left: `${10 + (i % 4) * 25}%`,
                  top: `${15 + Math.floor(i / 4) * 25}%`,
                },
              ]}
            />
          ))}
        </View>
        
        <View style={styles.instructionWrap}>
          <Text style={styles.instructionTitle}>🔍 Where Is It? 🔍</Text>
          <Text style={styles.instructionSubtitle}>Find and tap the star! ⭐</Text>
        </View>
        
        {/* Only the star is clickable - exact size match */}
        <Animated.View style={[styles.circle, circleStyle]} pointerEvents="box-none">
          <TouchableOpacity 
            style={styles.starHitArea} 
            activeOpacity={0.7} 
            onPress={handleTap}
          >
            <LinearGradient
              colors={['#F59E0B', '#F97316', '#EA580C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.circleFill}
            >
              <Text style={styles.starEmoji}>⭐</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
        <SparkleBurst key={sparkleKey} visible color="#F59E0B" count={15} size={8} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backButtonGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  hud: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 70,
    paddingHorizontal: 16,
  },
  hudCard: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    minWidth: 120,
    alignItems: 'center',
  },
  hudCardGradient: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '100%',
    alignItems: 'center',
    borderRadius: 18,
  },
  hudLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
    fontWeight: '700',
  },
  hudValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  starIcon: {
    width: 16,
    height: 16,
    resizeMode: 'contain',
  },
  playArea: {
    flex: 1,
    marginTop: 16,
    marginHorizontal: 12,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#A7F3D0',
    shadowColor: '#10B981',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backgroundPattern: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    opacity: 0.15,
  },
  patternDot: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#94A3B8',
  },
  circle: {
    position: 'absolute',
  },
  instructionWrap: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
    zIndex: 1,
  },
  instructionTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#065F46',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  instructionSubtitle: {
    fontSize: 15,
    color: '#047857',
    marginTop: 6,
    textAlign: 'center',
    fontWeight: '600',
  },
  starHitArea: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  circleFill: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  starEmoji: {
    fontSize: 50,
  },
  completion: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bigEmoji: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 8,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  subtitle: {
    fontSize: 18,
    color: '#92400E',
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '600',
  },
  statsBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    alignItems: 'center',
  },
  statsText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#78350F',
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#10B981',
  },
  primaryButton: {
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#22C55E',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  primaryButtonGradient: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 0.5,
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  secondaryButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 16,
  },
});


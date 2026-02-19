/**
 * OT Level 11 - Game 3: Follow and Touch
 * 
 * Core Goal: Dynamic Eye-Hand Coordination
 * - A large object moves slowly
 * - It stops
 * - Child taps when it stops
 * 
 * Skills trained:
 * - visual tracking
 * - motor timing
 * - hand control
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

const COLORS = ['#22C55E', '#3B82F6', '#F59E0B', '#F472B6', '#8B5CF6', '#06B6D4'];
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

interface FollowAndTouchGameProps {
  onBack: () => void;
}

export const FollowAndTouchGame: React.FC<FollowAndTouchGameProps> = ({ onBack }) => {
  const [score, setScore] = useState(0);
  const [targetsLeft, setTargetsLeft] = useState(10);
  const [done, setDone] = useState(false);
  const [isMoving, setIsMoving] = useState(true);
  const [isStopped, setIsStopped] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [sparkleKey, setSparkleKey] = useState(0);
  const playPop = usePopSound();

  const sizePct = 20;
  const radiusPct = sizePct / 2;

  const targetX = useSharedValue(50);
  const targetY = useSharedValue(50);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  const moveAndStop = () => {
    setIsMoving(true);
    setIsStopped(false);
    setColor(randomColor());
    
    // Move to random position slowly
    const margin = radiusPct + 5;
    const newX = margin + Math.random() * (100 - margin * 2);
    const newY = margin + Math.random() * (100 - margin * 2);
    
    targetX.value = withTiming(newX, { duration: 2000 }, (finished) => {
      if (finished) {
        runOnJS(setIsMoving)(false);
        runOnJS(setIsStopped)(true);
      }
    });
    targetY.value = withTiming(newY, { duration: 2000 });
    scale.value = withTiming(1, { duration: 2000 });
    opacity.value = withTiming(1, { duration: 2000 });
  };

  const handleTap = () => {
    if (!isStopped || isMoving) return;
    
    Haptics.selectionAsync().catch(() => {});
    playPop();
    scale.value = withSequence(withTiming(1.2, { duration: 100 }), withTiming(0, { duration: 150 }));
    opacity.value = withTiming(0, { duration: 180 });
    setSparkleKey(Date.now());
    setScore((s) => s + 1);
    setIsStopped(false);
    setTargetsLeft((t) => {
      const next = t - 1;
      if (next <= 0) {
        runOnJS(setDone)(true);
      } else {
        setTimeout(() => {
          runOnJS(moveAndStop)();
        }, 500);
      }
      return next;
    });
  };

  useEffect(() => {
    try {
      speakTTS('Watch it move, then tap it when it stops!', { rate: 0.78 });
    } catch {}
    moveAndStop();
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
        <View style={styles.completion}>
          <Animated.Text 
            style={styles.bigEmoji}
            entering={FadeIn.duration(600).delay(200)}
          >
            🎉✨🌟
          </Animated.Text>
          <Text style={styles.title}>Great Tracking! 👀</Text>
          <Text style={styles.subtitle}>You followed and touched {score} targets! ⭐</Text>
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
              setIsMoving(true);
              setIsStopped(false);
              moveAndStop();
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
      <TouchableOpacity onPress={() => { stopAllSpeech(); cleanupSounds(); onBack(); }} style={styles.backButton}>
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
        <View style={styles.instructionWrap}>
          <Text style={styles.instructionTitle}>👀 Follow and Touch 👀</Text>
          <Text style={styles.instructionSubtitle}>
            {isMoving ? 'Watch it move...' : isStopped ? 'Tap it now! ✨' : 'Get ready...'}
          </Text>
        </View>
        <Animated.View style={[styles.circle, circleStyle]}>
          <TouchableOpacity 
            style={styles.hitArea} 
            activeOpacity={0.7} 
            onPress={handleTap}
            disabled={isMoving || !isStopped}
          >
            <LinearGradient
              colors={[color, `${color}CC`, '#fff']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.circleFill}
            >
              <View style={styles.circleInnerGlow} />
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
        {isStopped && !isMoving && (
          <View style={styles.pulseIndicator}>
            <Text style={styles.pulseText}>✨ TAP NOW ✨</Text>
          </View>
        )}
        <SparkleBurst key={sparkleKey} visible color={color} count={15} size={8} />
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
  circle: {
    position: 'absolute',
  },
  instructionWrap: {
    alignItems: 'center',
    marginBottom: 40,
    paddingHorizontal: 20,
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
  hitArea: {
    flex: 1,
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  circleFill: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleInnerGlow: {
    width: '60%',
    height: '60%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#fff',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
  },
  pulseIndicator: {
    position: 'absolute',
    bottom: 40,
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#22C55E',
    shadowOpacity: 0.5,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pulseText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1,
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



/**
 * OT Level 11 - Game 4: Tap Where It Lights Up
 * 
 * Core Goal: Visual Memory & Motor Response Accuracy
 * - 3 large shapes appear
 * - One lights up briefly
 * - Shapes go neutral
 * - Child taps the one that lit up
 * 
 * Skills trained:
 * - visual memory
 * - motor response accuracy
 * - short-term VMI memory
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

const SHAPES = ['circle', 'square', 'triangle'];
const COLORS = ['#22C55E', '#3B82F6', '#F59E0B'];
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

interface TapWhereItLightsUpGameProps {
  onBack: () => void;
}

export const TapWhereItLightsUpGame: React.FC<TapWhereItLightsUpGameProps> = ({ onBack }) => {
  const [score, setScore] = useState(0);
  const [targetsLeft, setTargetsLeft] = useState(10);
  const [done, setDone] = useState(false);
  const [lightedIndex, setLightedIndex] = useState<number | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const playPop = usePopSound();

  const glowValues = [
    useSharedValue(0),
    useSharedValue(0),
    useSharedValue(0),
  ];

  const startRound = () => {
    setCanTap(false);
    setLightedIndex(null);
    
    // Reset all glows
    glowValues.forEach(g => g.value = 0);
    
    // Randomly select which shape lights up
    const index = Math.floor(Math.random() * 3);
    setLightedIndex(index);
    
    // Light up the selected shape
    glowValues[index].value = withSequence(
      withTiming(1, { duration: 300 }),
      withTiming(1, { duration: 800 }),
      withTiming(0, { duration: 300 }, () => {
        runOnJS(setCanTap)(true);
      })
    );
  };

  const handleTap = (index: number) => {
    if (!canTap || done) return;
    
    const isCorrect = index === lightedIndex;
    
    if (isCorrect) {
      Haptics.selectionAsync().catch(() => {});
      playPop();
      setSparkleKey(Date.now());
      setScore((s) => s + 1);
      setCanTap(false);
      setTargetsLeft((t) => {
        const next = t - 1;
        if (next <= 0) {
          runOnJS(setDone)(true);
        } else {
          setTimeout(() => {
            runOnJS(startRound)();
          }, 800);
        }
        return next;
      });
    } else {
      // Gentle feedback for wrong tap
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  };

  useEffect(() => {
    try {
      speakTTS('Watch which one lights up, then tap it!', { rate: 0.78 });
    } catch {}
    startRound();
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const getGlowStyle = (index: number) => {
    return useAnimatedStyle(() => {
      const glow = glowValues[index].value;
      return {
        transform: [{ scale: 1 + glow * 0.4 }], // 40% bigger - very visible!
      };
    });
  };

  // Bright overlay styles for each shape
  const overlayStyles = glowValues.map((glowValue, index) =>
    useAnimatedStyle(() => {
      const glow = glowValue.value;
      return {
        opacity: glow * 0.8, // Very visible overlay
        backgroundColor: COLORS[index],
      };
    })
  );

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
          <Text style={styles.title}>Great Memory! 🧠</Text>
          <Text style={styles.subtitle}>You remembered {score} shapes! ⭐</Text>
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
              setCanTap(false);
              startRound();
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
          <Text style={styles.instructionTitle}>💡 Tap Where It Lights Up 💡</Text>
          <Text style={styles.instructionSubtitle}>
            {canTap ? 'Which one lit up? Tap it! ✨' : 'Watch which one lights up...'}
          </Text>
        </View>
        <View style={styles.shapesRow}>
          {SHAPES.map((shape, index) => {
            const glowStyle = getGlowStyle(index);
            const overlayStyle = overlayStyles[index];
            return (
              <Animated.View key={index} style={glowStyle}>
                <TouchableOpacity
                  style={styles.shapeTouchArea}
                  activeOpacity={0.7}
                  onPress={() => handleTap(index)}
                  disabled={!canTap}
                >
                  <View style={styles.shapeContainer}>
                    <LinearGradient
                      colors={[COLORS[index], `${COLORS[index]}CC`, '#fff']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.shape,
                        shape === 'circle' && styles.circle,
                        shape === 'square' && styles.square,
                        shape === 'triangle' && styles.triangle,
                      ]}
                    >
                      <View style={styles.shapeInnerGlow} />
                    </LinearGradient>
                    {/* Bright colored overlay when glowing */}
                    {shape !== 'triangle' && (
                      <Animated.View
                        style={[
                          styles.shapeOverlay,
                          shape === 'circle' && styles.circleOverlay,
                          shape === 'square' && styles.squareOverlay,
                          overlayStyle,
                        ]}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
        <SparkleBurst key={sparkleKey} visible color={lightedIndex !== null ? COLORS[lightedIndex] : '#22C55E'} count={15} size={8} />
      </View>
    </SafeAreaView>
  );
};

const SHAPE_SIZE = 100;

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
  shapesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  shapeTouchArea: {
    padding: 8,
  },
  shapeContainer: {
    position: 'relative',
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
  },
  shapeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    pointerEvents: 'none',
  },
  circleOverlay: {
    borderRadius: SHAPE_SIZE / 2,
  },
  squareOverlay: {
    borderRadius: 12,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  circle: {
    borderRadius: SHAPE_SIZE / 2,
  },
  square: {
    borderRadius: 12,
  },
  triangle: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: SHAPE_SIZE / 2,
    borderRightWidth: SHAPE_SIZE / 2,
    borderBottomWidth: SHAPE_SIZE,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#22C55E',
  },
  shapeInnerGlow: {
    width: '60%',
    height: '60%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#fff',
    shadowOpacity: 0.8,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 0 },
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



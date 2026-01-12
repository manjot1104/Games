import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
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

interface BigTapTargetProps {
  onBack: () => void;
}

export const BigTapTarget: React.FC<BigTapTargetProps> = ({ onBack }) => {
  const router = useRouter();
  const [score, setScore] = useState(0);
  const [targetsLeft, setTargetsLeft] = useState(12);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [sparkleKey, setSparkleKey] = useState(0);
  // soft pop reinforcement
  const playPop = usePopSound();

  const sizePct = 26; // 26% of screen (within 20–30% target)
  const radiusPct = sizePct / 2;

  const targetX = useSharedValue(50);
  const targetY = useSharedValue(50);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  const spawnTarget = () => {
    const margin = radiusPct + 5; // avoid edges
    const x = margin + Math.random() * (100 - margin * 2);
    const y = margin + Math.random() * (100 - margin * 2);
    targetX.value = withTiming(x, { duration: 200 });
    targetY.value = withTiming(y, { duration: 200 });
    scale.value = withTiming(1, { duration: 180 });
    opacity.value = withTiming(1, { duration: 180 });
    setColor(randomColor());
  };

  const handleTap = () => {
    Haptics.selectionAsync().catch(() => {});
    playPop();
    scale.value = withSequence(withTiming(1.2, { duration: 80 }), withTiming(0, { duration: 120 }));
    opacity.value = withTiming(0, { duration: 140 });
    setSparkleKey(Date.now());
    setScore((s) => s + 1);
    setTargetsLeft((t) => {
      const next = t - 1;
      if (next <= 0) {
        runOnJS(finishGame)();
      } else {
        runOnJS(spawnTarget)();
      }
      return next;
    });
  };

  const finishGame = async () => {
    const total = 12;
    const finalScore = score + 1; // +1 because we just tapped
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    const stats = { correct: finalScore, total, xp };
    
    // Set all states together FIRST in same render cycle (like CatchTheBouncingStar)
    // Use React's automatic batching - all these updates happen together
    setFinalStats(stats);
    setDone(true);
    setShowCongratulations(true);
    
    Speech.speak('Amazing work! You completed the game!', { rate: 0.78 });
    
    // Log game in background (don't wait for it)
    try {
      const result = await logGameAndAward({
        type: 'big-tap-target',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['motor-control', 'hand-eye-coordination', 'targeting'],
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  };

  useEffect(() => {
    try {
      Speech.speak('Tap the big bubble! Burst it to earn a star!', { rate: 0.78 });
    } catch {}
    spawnTarget();
    return () => {
      // Cleanup: Stop speech when component unmounts
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
    transform: [{ translateX: -(sizePct / 2) + '%' as any }, { translateY: -(sizePct / 2) + '%' as any }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  // Show congratulations screen FIRST when game finishes (like CatchTheBouncingStar)
  // This is the ONLY completion screen - no ResultCard needed
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed for OT games)
          stopAllSpeech();
          cleanupSounds();
          onBack();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
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
        <View style={styles.instructionWrap}>
          <Text style={styles.instructionTitle}>✨ Tap the Big Bubble ✨</Text>
          <Text style={styles.instructionSubtitle}>Burst it to earn a star! 🌟</Text>
        </View>
        <Animated.View style={[styles.circle, circleStyle]}>
          <TouchableOpacity style={styles.hitArea} activeOpacity={0.7} onPress={handleTap}>
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
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});





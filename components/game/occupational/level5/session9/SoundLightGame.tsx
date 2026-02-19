import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech, playSound } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 100;
const TOLERANCE = 60;

const COLORS = [
  { name: 'Red', emoji: '🔴', color: '#EF4444', sound: 'drum' },
  { name: 'Blue', emoji: '🔵', color: '#3B82F6', sound: 'bell' },
  { name: 'Green', emoji: '🟢', color: '#10B981', sound: 'clap' },
];

const SoundLightGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [targetColor, setTargetColor] = useState<typeof COLORS[0] | null>(null);
  const [lightColor, setLightColor] = useState<typeof COLORS[0] | null>(null);
  const [soundPlayed, setSoundPlayed] = useState(false);
  const lightX = useSharedValue(SCREEN_WIDTH * 0.5);
  const lightY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const lightOpacity = useSharedValue(0);
  const lightScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const soundTimerRef = useRef<NodeJS.Timeout | null>(null);

  const generateRound = useCallback(() => {
    const target = COLORS[Math.floor(Math.random() * COLORS.length)];
    setTargetColor(target);
    setSoundPlayed(false);
    
    // Play sound
    playSound(target.sound as any, 0.7, 1.0);
    setSoundPlayed(true);

    // Show light (may or may not match)
    const lightMatches = Math.random() > 0.3; // 70% match
    const light = lightMatches ? target : COLORS.find(c => c.name !== target.name)!;
    setLightColor(light);

    lightX.value = Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2;
    lightY.value = Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100;
    lightOpacity.value = withTiming(1, { duration: 300 });
    lightScale.value = withSpring(1.2, {}, () => {
      lightScale.value = withSpring(1);
    });

    // Hide after 2 seconds
    if (soundTimerRef.current) {
      clearTimeout(soundTimerRef.current);
    }
    soundTimerRef.current = setTimeout(() => {
      lightOpacity.value = withTiming(0, { duration: 200 });
    }, 2000);
  }, [lightX, lightY, lightOpacity, lightScale]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || !targetColor || !lightColor || !soundPlayed) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - lightX.value, 2) + Math.pow(tapY - lightY.value, 2)
    );

    if (distance <= TOLERANCE + TARGET_SIZE / 2) {
      const isMatch = lightColor.name === targetColor.name;
      
      if (isMatch) {
        if (soundTimerRef.current) {
          clearTimeout(soundTimerRef.current);
        }
        lightOpacity.value = withTiming(0, { duration: 200 });

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              generateRound();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Match!', 0.9, 'en-US' );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Sound and light must match!', 0.8, 'en-US' );
      }
    }
  }, [done, targetColor, lightColor, soundPlayed, lightX, lightY, lightOpacity, generateRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 18;
    const accuracy = (finalScore / total) * 100;

    if (soundTimerRef.current) {
      clearTimeout(soundTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'sound-light',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['multi-sensory', 'auditory-visual-integration', 'matching'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      generateRound();
      setTimeout(() => {
        speakTTS('Match sound and light!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, generateRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (soundTimerRef.current) {
        clearTimeout(soundTimerRef.current);
      }
    };
  }, []);

  const lightStyle = useAnimatedStyle(() => ({
    left: lightX.value - TARGET_SIZE / 2,
    top: lightY.value - TARGET_SIZE / 2,
    opacity: lightOpacity.value,
    transform: [{ scale: lightScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Sound + Light"
        emoji="🎵"
        description="Match the sound with the light! Build multi-sensory skills."
        skills={['Multi-sensory']}
        suitableFor="Children learning multi-sensory integration"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            generateRound();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Sound + Light</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Match sound and light!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        {lightColor && (
          <Animated.View style={[styles.light, lightStyle, { backgroundColor: lightColor.color }]}>
            <Text style={styles.lightEmoji}>{lightColor.emoji}</Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Multi-sensory
        </Text>
        <Text style={styles.footerSubtext}>
          Match the sound with the light!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  light: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  lightEmoji: {
    fontSize: 50,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default SoundLightGame;

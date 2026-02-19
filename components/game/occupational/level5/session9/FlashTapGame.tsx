import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FLASH_SIZE = 150;
const TOLERANCE = 80;
const FLASH_DURATION = 500; // 500ms flash

const FlashTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const flashX = useSharedValue(SCREEN_WIDTH * 0.5);
  const flashY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const flashOpacity = useSharedValue(0);
  const flashScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [flashActive, setFlashActive] = useState(false);

  const showFlash = useCallback(() => {
    flashX.value = Math.random() * (screenWidth.current - FLASH_SIZE) + FLASH_SIZE / 2;
    flashY.value = Math.random() * (screenHeight.current - FLASH_SIZE - 200) + FLASH_SIZE / 2 + 100;
    
    flashOpacity.value = withTiming(1, { duration: 100 });
    flashScale.value = withSpring(1.2, {}, () => {
      flashScale.value = withSpring(1);
    });
    setFlashActive(true);

    // Hide flash after duration
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      flashOpacity.value = withTiming(0, { duration: 200 });
      setFlashActive(false);
    }, FLASH_DURATION);
  }, [flashX, flashY, flashOpacity, flashScale]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || !flashActive) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - flashX.value, 2) + Math.pow(tapY - flashY.value, 2)
    );

    if (distance <= TOLERANCE + FLASH_SIZE / 2) {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
      flashOpacity.value = withTiming(0, { duration: 200 });
      setFlashActive(false);

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => showFlash(), 1000);
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Fast reflex!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, flashActive, flashX, flashY, flashOpacity, showFlash]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'flash-tap',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reflex', 'reaction-time', 'visual-response'],
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
      setTimeout(() => {
        showFlash();
        speakTTS('Tap when light flashes!', 0.8, 'en-US' );
      }, 1000);
    }
  }, [showInfo, round, done, showFlash]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const flashStyle = useAnimatedStyle(() => ({
    left: flashX.value - FLASH_SIZE / 2,
    top: flashY.value - FLASH_SIZE / 2,
    opacity: flashOpacity.value,
    transform: [{ scale: flashScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Flash Tap"
        emoji="💡"
        description="Tap quickly when the light flashes! Build reflex."
        skills={['Reflex']}
        suitableFor="Children learning fast reflexes and reaction time"
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
            showFlash();
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
        <Text style={styles.title}>Flash Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💡 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap when light flashes!
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
        <Animated.View style={[styles.flash, flashStyle]}>
          <Text style={styles.flashEmoji}>💡</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Reflex
        </Text>
        <Text style={styles.footerSubtext}>
          Tap quickly when the light flashes!
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
  flash: {
    position: 'absolute',
    width: FLASH_SIZE,
    height: FLASH_SIZE,
    borderRadius: FLASH_SIZE / 2,
    backgroundColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#F59E0B',
    shadowColor: '#FCD34D',
    shadowOpacity: 0.8,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  flashEmoji: {
    fontSize: 60,
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

export default FlashTapGame;

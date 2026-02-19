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
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const KEY_WIDTH = 100;
const KEY_HEIGHT = 150;
const TIME_LIMIT = 3000; // 3 seconds to tap both

const PianoKeysGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftPressed, setLeftPressed] = useState(false);
  const [rightPressed, setRightPressed] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(TIME_LIMIT);
  const [timerActive, setTimerActive] = useState(false);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftColor = useSharedValue('#8B5CF6');
  const rightColor = useSharedValue('#8B5CF6');
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRound = useCallback(() => {
    setLeftPressed(false);
    setRightPressed(false);
    setTimeRemaining(TIME_LIMIT);
    setTimerActive(true);
    leftScale.value = withSpring(1);
    rightScale.value = withSpring(1);
    leftColor.value = '#8B5CF6';
    rightColor.value = '#8B5CF6';

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = prev - 100;
        if (newTime <= 0) {
          clearInterval(timer);
          setTimerActive(false);
          // Time's up
          if (!leftPressed || !rightPressed) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            speakTTS('Tap both keys together!', 0.8, 'en-US' );
            setTimeout(() => {
              if (round < TOTAL_ROUNDS) {
                setRound((r) => r + 1);
                startRound();
              } else {
                endGame(score);
              }
            }, 1500);
          }
          return 0;
        }
        return newTime;
      });
    }, 100);

    timerRef.current = timer as unknown as NodeJS.Timeout;
  }, [leftPressed, rightPressed, round, score]);

  const handleLeftKey = useCallback(() => {
    if (done || !timerActive || leftPressed) return;
    setLeftPressed(true);
    leftScale.value = withSpring(0.9);
    leftColor.value = '#10B981';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (rightPressed) {
      // Both pressed together!
      if (timerRef.current) {
        clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
        timerRef.current = null;
      }
      setTimerActive(false);
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            startRound();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect! Both keys!', 0.9, 'en-US' );
    }
  }, [done, timerActive, leftPressed, rightPressed, leftScale, leftColor, startRound]);

  const handleRightKey = useCallback(() => {
    if (done || !timerActive || rightPressed) return;
    setRightPressed(true);
    rightScale.value = withSpring(0.9);
    rightColor.value = '#10B981';
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (leftPressed) {
      // Both pressed together!
      if (timerRef.current) {
        clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
        timerRef.current = null;
      }
      setTimerActive(false);
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            startRound();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect! Both keys!', 0.9, 'en-US' );
    }
  }, [done, timerActive, leftPressed, rightPressed, rightScale, rightColor, startRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setTimerActive(false);

    if (timerRef.current) {
      clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      timerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'piano-keys',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['hand-synchronization', 'two-hand-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setTimeout(() => {
        startRound();
        speakTTS('Tap both keys together!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      }
    };
  }, []);

  const leftKeyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftScale.value }],
    backgroundColor: leftColor.value,
  }));

  const rightKeyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightScale.value }],
    backgroundColor: rightColor.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Piano Keys"
        emoji="🎹"
        description="Tap left key and right key together at the same time!"
        skills={['Hand synchronization']}
        suitableFor="Children learning hand synchronization through piano key tapping"
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
            startRound();
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
        <Text style={styles.title}>Piano Keys</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎹 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {timerActive ? `Time: ${(timeRemaining / 1000).toFixed(1)}s` : 'Tap both keys together!'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.keysContainer}>
          <TouchableOpacity
            style={styles.keyWrapper}
            onPress={handleLeftKey}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.key, styles.leftKey, leftKeyStyle]}>
              <Text style={styles.keyEmoji}>⬅️</Text>
              <Text style={styles.keyLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.keyWrapper}
            onPress={handleRightKey}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.key, styles.rightKey, rightKeyStyle]}>
              <Text style={styles.keyEmoji}>➡️</Text>
              <Text style={styles.keyLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Hand synchronization
        </Text>
        <Text style={styles.footerSubtext}>
          Tap left key and right key together at the same time!
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
    color: '#8B5CF6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  keysContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  keyWrapper: {
    width: KEY_WIDTH,
    height: KEY_HEIGHT,
  },
  key: {
    width: KEY_WIDTH,
    height: KEY_HEIGHT,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#7C3AED',
  },
  leftKey: {
    // Animated color
  },
  rightKey: {
    // Animated color
  },
  keyEmoji: {
    fontSize: 50,
    marginBottom: 10,
  },
  keyLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
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

export default PianoKeysGame;

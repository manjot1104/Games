import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 15;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 140;
const INITIAL_DISPLAY_TIME = 1500; // Start with 1.5 seconds
const MIN_DISPLAY_TIME = 600; // Fastest: 0.6 seconds
const TIME_DECREASE = 100; // Decrease by 100ms each round

type Side = 'left' | 'right';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const FastSwitchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [activeSide, setActiveSide] = useState<Side | null>(null);
  const [hasTapped, setHasTapped] = useState(false);
  const [displayTime, setDisplayTime] = useState(INITIAL_DISPLAY_TIME);

  const leftTargetScale = useRef(new Animated.Value(1)).current;
  const rightTargetScale = useRef(new Animated.Value(1)).current;
  const leftTargetOpacity = useRef(new Animated.Value(0.3)).current;
  const rightTargetOpacity = useRef(new Animated.Value(0.3)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTarget = useCallback(() => {
    // Randomly choose side
    const side: Side = Math.random() < 0.5 ? 'left' : 'right';
    setActiveSide(side);
    setHasTapped(false);
    
    // Reset scales
    leftTargetScale.setValue(1);
    rightTargetScale.setValue(1);
    
    // Calculate current display time (gets faster as rounds progress)
    const currentTime = Math.max(
      MIN_DISPLAY_TIME,
      INITIAL_DISPLAY_TIME - (round - 1) * TIME_DECREASE
    );
    setDisplayTime(currentTime);
    
    // Animate active target
    if (side === 'left') {
      leftTargetOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(leftTargetOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(leftTargetOpacity, {
              toValue: 0.7,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(leftTargetOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      rightTargetOpacity.setValue(0.3);
    } else {
      rightTargetOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(rightTargetOpacity, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(rightTargetOpacity, {
              toValue: 0.7,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(rightTargetOpacity, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      leftTargetOpacity.setValue(0.3);
    }
    
    // Auto-advance after display time
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (!hasTapped && activeSide === side) {
        handleTimeout();
      }
    }, currentTime);
  }, [leftTargetOpacity, rightTargetOpacity, hasTapped, activeSide, round]);

  const handleLeftTap = useCallback(() => {
    if (done || !activeSide || hasTapped) return;
    
    if (activeSide === 'left') {
      handleSuccess('left');
    } else {
      handleWrong();
    }
  }, [done, activeSide, hasTapped]);

  const handleRightTap = useCallback(() => {
    if (done || !activeSide || hasTapped) return;
    
    if (activeSide === 'right') {
      handleSuccess('right');
    } else {
      handleWrong();
    }
  }, [done, activeSide, hasTapped]);

  const handleSuccess = useCallback((side: Side) => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    const targetScale = side === 'left' ? leftTargetScale : rightTargetScale;
    
    Animated.sequence([
      Animated.timing(targetScale, {
        toValue: 1.3,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(targetScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    // Quick fade out
    const targetOpacity = side === 'left' ? leftTargetOpacity : rightTargetOpacity;
    Animated.timing(targetOpacity, {
      toValue: 0.3,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setActiveSide(null);
      
      // Very quick transition for fast switching
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          showTarget();
        } else {
          endGame();
        }
      }, 200);
    });
  }, [round, leftTargetScale, rightTargetScale, leftTargetOpacity, rightTargetOpacity, showTarget]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    
    // Quick shake
    const wrongScale = activeSide === 'left' ? rightTargetScale : leftTargetScale;
    Animated.sequence([
      Animated.timing(wrongScale, {
        toValue: 0.9,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(wrongScale, {
        toValue: 1,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeSide, leftTargetScale, rightTargetScale]);

  const handleTimeout = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    
    setActiveSide(null);
    leftTargetOpacity.setValue(0.3);
    rightTargetOpacity.setValue(0.3);
    
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showTarget();
      } else {
        endGame();
      }
    }, 200);
  }, [hasTapped, round, leftTargetOpacity, rightTargetOpacity, showTarget]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setActiveSide(null);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'fast-switch',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['brain-speed', 'rapid-switching', 'alternating-sides', 'reaction-time'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        showTarget();
      }, 300);
    }
  }, [showInfo, round, done, showTarget]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const getSpeedText = () => {
    if (displayTime >= 1200) return 'Normal';
    if (displayTime >= 800) return 'Fast';
    return 'Very Fast!';
  };

  const leftTargetStyle = {
    opacity: leftTargetOpacity,
    transform: [{ scale: leftTargetScale }],
  };

  const rightTargetStyle = {
    opacity: rightTargetOpacity,
    transform: [{ scale: rightTargetScale }],
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Fast Switch"
        emoji="⚡"
        description="Rapid side switching! Brain speed training!"
        skills={['Brain speed', 'Rapid switching', 'Alternating sides']}
        suitableFor="Children learning rapid side switching and brain speed"
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
            setActiveSide(null);
            setDisplayTime(INITIAL_DISPLAY_TIME);
            leftTargetOpacity.setValue(0.3);
            rightTargetOpacity.setValue(0.3);
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
        <Text style={styles.title}>Fast Switch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.speedIndicator}>
          Speed: {getSpeedText()} ({displayTime}ms)
        </Text>
        <Text style={styles.instruction}>
          {activeSide ? `Tap ${activeSide} side!` : 'Wait for target...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.targetsContainer}>
          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.target, styles.leftTarget, leftTargetStyle]}>
              <Text style={styles.targetEmoji}>👈</Text>
              <Text style={styles.targetLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.target, styles.rightTarget, rightTargetStyle]}>
              <Text style={styles.targetEmoji}>👉</Text>
              <Text style={styles.targetLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Brain speed • Rapid switching • Alternating sides
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
    marginBottom: 8,
  },
  speedIndicator: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '700',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  targetsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  targetButton: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
  },
  target: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftTarget: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightTarget: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  targetEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  targetLabel: {
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
    textAlign: 'center',
  },
});

export default FastSwitchGame;

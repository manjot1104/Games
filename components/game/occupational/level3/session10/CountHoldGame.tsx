import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HOLD_TIME = 5000; // 5 seconds
const POSE_DISPLAY_TIME = 2000;

type PoseType = 'arms-up' | 'one-leg' | 'star' | 'warrior';

const POSE_EMOJIS: Record<PoseType, string> = {
  'arms-up': '🙌',
  'one-leg': '🦵',
  'star': '⭐',
  'warrior': '⚔️',
};

const CountHoldGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPose, setShowPose] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseType>('arms-up');
  const [isHolding, setIsHolding] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [canHold, setCanHold] = useState(false);

  const poseScale = useRef(new Animated.Value(1)).current;
  const poseOpacity = useRef(new Animated.Value(0)).current;
  const countdownOpacity = useRef(new Animated.Value(0)).current;
  const poseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const showPoseOnScreen = useCallback(() => {
    if (done) return;

    const poses: PoseType[] = ['arms-up', 'one-leg', 'star', 'warrior'];
    const randomPose = poses[Math.floor(Math.random() * poses.length)];
    setCurrentPose(randomPose);
    
    setShowPose(true);
    setCanHold(false);
    setIsHolding(false);
    setCountdown(5);
    poseOpacity.setValue(0);
    poseScale.setValue(0.5);
    countdownOpacity.setValue(0);
    
    Animated.parallel([
      Animated.spring(poseScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(poseOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    const poseName = randomPose === 'arms-up' ? 'arms up' : 
                    randomPose === 'one-leg' ? 'one leg' :
                    randomPose === 'star' ? 'star' : 'warrior';

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(`Get ready! ${poseName} pose!`, 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS(`Get ready! ${poseName} pose!`, 0.8, 'en-US' );
    }

    poseTimeoutRef.current = setTimeout(() => {
      setCanHold(true);
      setIsHolding(true);
      Animated.timing(countdownOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      speakTTS('Hold for 5 seconds!', 0.8, 'en-US' );

      // Start countdown from 5 to 0
      let currentCount = 5;
      const countdownInterval = setInterval(() => {
        currentCount--;
        setCountdown(currentCount);
        
        if (currentCount > 0) {
          speakTTS(currentCount.toString(), 0.9, 'en-US' );
        }
        
        if (currentCount <= 0) {
          clearInterval(countdownInterval);
          // Success!
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          speakTTS('Perfect!', 0.9, 'en-US' );
          
          Animated.sequence([
            Animated.timing(poseScale, {
              toValue: 1.3,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(poseScale, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start();

          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowPose(false);
              setIsHolding(false);
              poseOpacity.setValue(0);
              poseScale.setValue(1);
              countdownOpacity.setValue(0);
            } else {
              endGame();
            }
          }, 1000);
        }
      }, 1000);

      countdownRef.current = countdownInterval as unknown as NodeJS.Timeout;
    }, POSE_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, poseScale, poseOpacity, countdownOpacity, round]);

  const handleRelease = useCallback(() => {
    if (!isHolding || !canHold || done) return;

    setIsHolding(false);
    setCanHold(false);
    
    if (countdownRef.current) {
      clearInterval(countdownRef.current as unknown as ReturnType<typeof setInterval>);
      countdownRef.current = null;
    }

    if (countdown > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      speakTTS('Hold longer!', 0.8, 'en-US' );
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowPose(false);
          setCountdown(5);
          poseOpacity.setValue(0);
          poseScale.setValue(1);
          countdownOpacity.setValue(0);
        } else {
          endGame();
        }
      }, 1000);
    }
  }, [isHolding, canHold, done, countdown, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showPoseOnScreen();
    }, 500);
  }, [done, showPoseOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPose(false);
    setIsHolding(false);

    if (poseTimeoutRef.current) {
      clearTimeout(poseTimeoutRef.current);
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current as unknown as ReturnType<typeof setInterval>);
    }

    try {
      await logGameAndAward({
        type: 'count-hold',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['endurance', 'posture', 'time-holding'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
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
      if (poseTimeoutRef.current) {
        clearTimeout(poseTimeoutRef.current);
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current as unknown as ReturnType<typeof setInterval>);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Count Hold"
        emoji="⏱️"
        description="Hold the pose for 5 seconds!"
        skills={['Endurance']}
        suitableFor="Children learning endurance through timed pose holding"
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
            setShowPose(false);
            setIsHolding(false);
            setCountdown(5);
            poseOpacity.setValue(0);
            poseScale.setValue(1);
            countdownOpacity.setValue(0);
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
        <Text style={styles.title}>Count Hold</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⏱️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canHold ? 'Hold for 5 seconds!' : 'Get ready...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPose && (
          <View style={styles.poseContainer}>
            <Animated.View
              style={[
                styles.poseDisplay,
                {
                  transform: [{ scale: poseScale }],
                  opacity: poseOpacity,
                },
              ]}
            >
              <Text style={styles.poseEmoji}>{POSE_EMOJIS[currentPose]}</Text>
              <Text style={styles.poseLabel}>{currentPose.toUpperCase().replace('-', ' ')}</Text>
            </Animated.View>

            {isHolding && (
              <Animated.View
                style={[
                  styles.countdownContainer,
                  {
                    opacity: countdownOpacity,
                  },
                ]}
              >
                <Text style={styles.countdownText}>
                  {countdown}
                </Text>
                <Text style={styles.holdInstruction}>HOLD!</Text>
              </Animated.View>
            )}
          </View>
        )}

        {!showPose && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Endurance
        </Text>
        <Text style={styles.footerSubtext}>
          Hold the pose while counting down from 5!
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
    color: '#10B981',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  poseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  poseDisplay: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  poseEmoji: {
    fontSize: 150,
    marginBottom: 10,
  },
  poseLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
  },
  countdownContainer: {
    alignItems: 'center',
    marginTop: 20,
  },
  countdownText: {
    fontSize: 72,
    fontWeight: '900',
    color: '#10B981',
    marginBottom: 10,
  },
  holdInstruction: {
    fontSize: 28,
    fontWeight: '800',
    color: '#10B981',
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
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

export default CountHoldGame;

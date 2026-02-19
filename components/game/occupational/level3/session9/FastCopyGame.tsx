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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FAST_POSE_TIME = 1500; // Time to show each pose (ms) - faster!
const RESPONSE_TIME = 2000; // Time to copy each pose (ms) - faster!

type PoseType = 'hands-up' | 'hands-down' | 'hands-left' | 'hands-right' | 'clap';

const POSE_EMOJIS: Record<PoseType, string> = {
  'hands-up': '🙌',
  'hands-down': '👇',
  'hands-left': '👈',
  'hands-right': '👉',
  'clap': '👏',
};

const FastCopyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showPose, setShowPose] = useState(false);
  const [currentPose, setCurrentPose] = useState<PoseType>('hands-up');
  const [canCopy, setCanCopy] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const [poseCount, setPoseCount] = useState(0);
  const [posesInRound, setPosesInRound] = useState(3); // 3 poses per round

  const poseScale = useRef(new Animated.Value(1)).current;
  const poseOpacity = useRef(new Animated.Value(0)).current;
  const poseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showNextPose = useCallback(() => {
    if (done) return;

    const poses: PoseType[] = ['hands-up', 'hands-down', 'hands-left', 'hands-right', 'clap'];
    const randomPose = poses[Math.floor(Math.random() * poses.length)];
    setCurrentPose(randomPose);
    
    setShowPose(true);
    setCanCopy(false);
    setHasCopied(false);
    poseOpacity.setValue(0);
    poseScale.setValue(0.5);
    
    // Fast show animation
    Animated.parallel([
      Animated.spring(poseScale, {
        toValue: 1,
        tension: 70, // Faster spring
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.timing(poseOpacity, {
        toValue: 1,
        duration: 200, // Faster fade
        useNativeDriver: true,
      }),
    ]).start();

    const poseName = randomPose === 'hands-up' ? 'hands up' : 
                    randomPose === 'hands-down' ? 'hands down' :
                    randomPose === 'hands-left' ? 'hands left' :
                    randomPose === 'hands-right' ? 'hands right' : 'clap';

    // Quick instruction
    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(`${poseName}!`, 1.0, 'en-US' ); // Faster speech
      }, 100);
    } else {
      speakTTS(`${poseName}!`, 1.0, 'en-US' );
    }

    // Quickly allow copying
    poseTimeoutRef.current = setTimeout(() => {
      setCanCopy(true);
      speakTTS('Copy!', 1.2, 'en-US' );

      copyTimeoutRef.current = setTimeout(() => {
        setCanCopy(false);
        if (!hasCopied) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Faster!', 1.0, 'en-US' );
        }
        
        // Move to next pose or round
        if (poseCount < posesInRound - 1) {
          setPoseCount((c) => c + 1);
          setTimeout(() => {
            showNextPose();
          }, 500);
        } else {
          // Round complete
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            setPoseCount(0);
            setShowPose(false);
            poseOpacity.setValue(0);
            poseScale.setValue(1);
          } else {
            endGame();
          }
        }
      }, RESPONSE_TIME) as unknown as NodeJS.Timeout;
    }, FAST_POSE_TIME) as unknown as NodeJS.Timeout;
  }, [done, poseScale, poseOpacity, round, hasCopied, poseCount, posesInRound]);

  const handleCopy = useCallback(() => {
    if (!canCopy || done || !showPose || hasCopied) return;

    setHasCopied(true);
    setScore((s) => s + 1);
    
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Fast!', 1.2, 'en-US' );
    
    // Quick success animation
    Animated.sequence([
      Animated.timing(poseScale, {
        toValue: 1.2,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(poseScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();

    // Move to next pose quickly
    setTimeout(() => {
      if (poseCount < posesInRound - 1) {
        setPoseCount((c) => c + 1);
        setHasCopied(false);
        setTimeout(() => {
          showNextPose();
        }, 300);
      } else {
        // Round complete
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setPoseCount(0);
          setShowPose(false);
          setHasCopied(false);
          poseOpacity.setValue(0);
          poseScale.setValue(1);
        } else {
          endGame();
        }
      }
    }, 500);
  }, [canCopy, done, showPose, hasCopied, poseScale, round, poseCount, posesInRound, showNextPose]);

  const startRound = useCallback(() => {
    if (done) return;
    setPoseCount(0);
    setTimeout(() => {
      showNextPose();
    }, 500);
  }, [done, showNextPose]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * posesInRound;
    const xp = score * 10;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowPose(false);

    if (poseTimeoutRef.current) {
      clearTimeout(poseTimeoutRef.current);
    }
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'fast-copy',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['speed', 'accuracy', 'quick-response'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router, posesInRound]);

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
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Fast Copy"
        emoji="⚡"
        description="Quick changing poses! Copy them fast!"
        skills={['Speed', 'Accuracy', 'Quick response']}
        suitableFor="Children learning speed and accuracy in movement imitation"
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
            setHasCopied(false);
            setPoseCount(0);
            poseOpacity.setValue(0);
            poseScale.setValue(1);
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
        <Text style={styles.title}>Fast Copy</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canCopy ? 'Copy fast!' : 'Watch the pose...'}
        </Text>
        <Text style={styles.poseCounter}>
          Pose {poseCount + 1}/{posesInRound}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showPose && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleCopy}
            style={styles.tapArea}
            disabled={!canCopy}
          >
            <Animated.View
              style={[
                styles.poseContainer,
                {
                  transform: [{ scale: poseScale }],
                  opacity: poseOpacity,
                },
              ]}
            >
              <Text style={styles.poseEmoji}>{POSE_EMOJIS[currentPose]}</Text>
              {canCopy && (
                <Text style={styles.fastLabel}>⚡ COPY FAST! ⚡</Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        )}

        {!showPose && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Speed • Accuracy • Quick response
        </Text>
        <Text style={styles.footerSubtext}>
          Poses change quickly - copy them fast!
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
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  poseCounter: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  poseContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  poseEmoji: {
    fontSize: 150,
    marginBottom: 20,
  },
  fastLabel: {
    fontSize: 22,
    fontWeight: '800',
    color: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
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

export default FastCopyGame;

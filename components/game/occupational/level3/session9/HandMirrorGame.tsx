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
const HAND_DISPLAY_TIME = 2500;
const RESPONSE_TIME = 3000;

type HandSide = 'left' | 'right';

const HandMirrorGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showHand, setShowHand] = useState(false);
  const [screenHand, setScreenHand] = useState<HandSide>('left');
  const [canMirror, setCanMirror] = useState(false);
  const [hasMirrored, setHasMirrored] = useState(false);

  const handScale = useRef(new Animated.Value(1)).current;
  const handOpacity = useRef(new Animated.Value(0)).current;
  const handTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mirrorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showHandOnScreen = useCallback(() => {
    if (done) return;

    // Random hand side
    const side: HandSide = Math.random() > 0.5 ? 'left' : 'right';
    setScreenHand(side);
    
    setShowHand(true);
    setCanMirror(false);
    setHasMirrored(false);
    handOpacity.setValue(0);
    handScale.setValue(0.5);
    
    Animated.parallel([
      Animated.spring(handScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(handOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    handTimeoutRef.current = setTimeout(() => {
      setCanMirror(true);
      // Mirror: screen left = child right, screen right = child left
      const childSide = side === 'left' ? 'right' : 'left';
      
      if (Platform.OS === 'web') {
        setTimeout(() => {
          speakTTS(`Screen shows ${side} hand! You raise your ${childSide} hand!`, 0.8, 'en-US' );
        }, 300);
      } else {
        speakTTS(`Screen shows ${side} hand! You raise your ${childSide} hand!`, 0.8, 'en-US' );
      }

      mirrorTimeoutRef.current = setTimeout(() => {
        setCanMirror(false);
        if (!hasMirrored) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Mirror the hand!', 0.8, 'en-US' );
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowHand(false);
              handOpacity.setValue(0);
              handScale.setValue(1);
            } else {
              endGame();
            }
          }, 1000);
        }
      }, RESPONSE_TIME) as unknown as NodeJS.Timeout;
    }, HAND_DISPLAY_TIME) as unknown as NodeJS.Timeout;
  }, [done, handScale, handOpacity, round, hasMirrored]);

  const handleMirror = useCallback(() => {
    if (!canMirror || done || !showHand || hasMirrored) return;

    setHasMirrored(true);
    setScore((s) => s + 1);
    
    if (mirrorTimeoutRef.current) {
      clearTimeout(mirrorTimeoutRef.current);
      mirrorTimeoutRef.current = null;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect mirror!', 0.9, 'en-US' );
    
    Animated.sequence([
      Animated.timing(handScale, {
        toValue: 1.3,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(handScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowHand(false);
        handOpacity.setValue(0);
        handScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [canMirror, done, showHand, hasMirrored, handScale, round]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showHandOnScreen();
    }, 500);
  }, [done, showHandOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowHand(false);

    if (handTimeoutRef.current) {
      clearTimeout(handTimeoutRef.current);
    }
    if (mirrorTimeoutRef.current) {
      clearTimeout(mirrorTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'hand-mirror',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['brain-coordination', 'mirror-movements'],
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
      if (handTimeoutRef.current) {
        clearTimeout(handTimeoutRef.current);
      }
      if (mirrorTimeoutRef.current) {
        clearTimeout(mirrorTimeoutRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Hand Mirror"
        emoji="👋"
        description="Screen shows left hand → you raise right hand! Mirror the hand!"
        skills={['Brain coordination', 'Mirror movements']}
        suitableFor="Children learning brain coordination and mirror movements"
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
            setShowHand(false);
            setHasMirrored(false);
            handOpacity.setValue(0);
            handScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  const childSide = screenHand === 'left' ? 'right' : 'left';

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
        <Text style={styles.title}>Hand Mirror</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👋 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {canMirror ? `Screen ${screenHand} → You raise ${childSide}!` : 'Watch the hand...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showHand && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleMirror}
            style={styles.tapArea}
            disabled={!canMirror}
          >
            <Animated.View
              style={[
                styles.handContainer,
                {
                  transform: [{ scale: handScale }],
                  opacity: handOpacity,
                },
              ]}
            >
              <Text style={styles.handEmoji}>
                {screenHand === 'left' ? '👈' : '👉'}
              </Text>
              {canMirror && (
                <Text style={styles.mirrorLabel}>
                  MIRROR: {childSide.toUpperCase()} HAND
                </Text>
              )}
            </Animated.View>
          </TouchableOpacity>
        )}

        {!showHand && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Brain coordination • Mirror movements
        </Text>
        <Text style={styles.footerSubtext}>
          Screen left = your right, Screen right = your left!
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
    position: 'relative',
    marginVertical: 40,
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  handContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  handEmoji: {
    fontSize: 150,
    marginBottom: 20,
  },
  mirrorLabel: {
    fontSize: 20,
    fontWeight: '800',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
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

export default HandMirrorGame;

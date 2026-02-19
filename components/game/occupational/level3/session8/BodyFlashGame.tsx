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
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FLASH_DURATION = 800; // ms - how long body part is visible
const RESPONSE_WINDOW = 1500; // ms - time to tap after flash

type BodyPart = 'head' | 'shoulder' | 'arm' | 'leg' | 'hand' | 'foot';

const BODY_PARTS: Record<BodyPart, { emoji: string; label: string; x: number; y: number }> = {
  head: { emoji: '👤', label: 'Head', x: 50, y: 20 },
  shoulder: { emoji: '💪', label: 'Shoulder', x: 40, y: 35 },
  arm: { emoji: '💪', label: 'Arm', x: 35, y: 45 },
  hand: { emoji: '✋', label: 'Hand', x: 30, y: 55 },
  leg: { emoji: '🦵', label: 'Leg', x: 45, y: 65 },
  foot: { emoji: '👣', label: 'Foot', x: 50, y: 80 },
};

const BodyFlashGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showFlash, setShowFlash] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);
  const [currentPart, setCurrentPart] = useState<BodyPart | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [tapsCount, setTapsCount] = useState(0);

  const partScale = useRef(new Animated.Value(1)).current;
  const partOpacity = useRef(new Animated.Value(0)).current;
  const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const responseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Flash a body part
  const flashBodyPart = useCallback(() => {
    if (done || !showFlash || hasTapped) return;

    // Random body part
    const parts: BodyPart[] = ['head', 'shoulder', 'arm', 'hand', 'leg', 'foot'];
    const part = parts[Math.floor(Math.random() * parts.length)];
    setCurrentPart(part);
    setIsVisible(true);

    // Flash animation - appear
    Animated.parallel([
      Animated.sequence([
        Animated.timing(partScale, {
          toValue: 1.5,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(partScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(partOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Hide after flash duration
    flashTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      Animated.timing(partOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();

      // Wait for user response
      responseTimeoutRef.current = setTimeout(() => {
        // Time's up - no tap
        if (!hasTapped) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS(`${BODY_PARTS[part].label} tap karna tha! Dobara try karo!`, 0.8 );
          
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
              setShowFlash(false);
              setHasTapped(false);
              setCurrentPart(null);
              setIsVisible(false);
              partScale.setValue(1);
              partOpacity.setValue(0);
            } else {
              endGame();
            }
          }, 1500);
        }
      }, RESPONSE_WINDOW) as unknown as NodeJS.Timeout;
    }, FLASH_DURATION) as unknown as NodeJS.Timeout;
  }, [done, showFlash, hasTapped, round, partScale, partOpacity]);

  const handlePartTap = useCallback(() => {
    if (done || !showFlash || hasTapped || !currentPart || !isVisible) return;

    // Clear timeouts
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = null;
    }
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }

    // Correct tap!
    setHasTapped(true);
    setIsVisible(false);
    setTapsCount((c) => c + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS(`Perfect! ${BODY_PARTS[currentPart].label} tap ho gaya!`, 0.9 );
    
    // Success animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(partScale, {
          toValue: 1.8,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(partOpacity, {
          toValue: 0.8,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(partScale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(partOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      setScore((s) => s + 1);
      
      if (tapsCount + 1 >= 5) {
        // Completed 5 taps for this round
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowFlash(false);
          setHasTapped(false);
          setCurrentPart(null);
          setIsVisible(false);
          setTapsCount(0);
          partScale.setValue(1);
          partOpacity.setValue(0);
        } else {
          endGame();
        }
      } else {
        // Continue flashing
        setHasTapped(false);
        setCurrentPart(null);
        setIsVisible(false);
        partScale.setValue(1);
        partOpacity.setValue(0);
        setTimeout(() => {
          flashBodyPart();
        }, 500);
      }
    }, 1000);
  }, [done, showFlash, hasTapped, currentPart, isVisible, tapsCount, round, partScale, partOpacity, flashBodyPart]);

  const showFlashObject = useCallback(() => {
    setShowFlash(true);
    setHasTapped(false);
    setCurrentPart(null);
    setIsVisible(false);
    setTapsCount(0);
    partScale.setValue(1);
    partOpacity.setValue(0);
    
    // Start flashing after a delay
    setTimeout(() => {
      flashBodyPart();
      speakTTS('Body part flash hoga! Jaldi se tap karo!', 0.8 );
    }, 500);
  }, [partScale, partOpacity, flashBodyPart]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showFlashObject();
    }, 500);
  }, [done, showFlashObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * 5; // 5 taps per round
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowFlash(false);

    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['fast-recognition', 'body-parts', 'reaction-time'],
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
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Body Flash"
        emoji="⚡"
        description="Quick body part flash! Body part jaldi se flash hoga, usko tap karo!"
        skills={['Fast recognition', 'Body parts', 'Reaction time']}
        suitableFor="Children learning fast recognition and body part identification"
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

  // Result screen
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
            setShowFlash(false);
            setHasTapped(false);
            setCurrentPart(null);
            setIsVisible(false);
            setTapsCount(0);
            partScale.setValue(1);
            partOpacity.setValue(0);
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
        <Text style={styles.title}>Body Flash</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Body part jaldi se flash hoga! Jaldi se tap karo!
        </Text>
        {tapsCount > 0 && (
          <Text style={styles.progressText}>
            Taps: {tapsCount}/5
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showFlash && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handlePartTap}
            style={styles.flashArea}
            disabled={!isVisible || hasTapped}
          >
            {currentPart && isVisible && (
              <Animated.View
                style={[
                  styles.partContainer,
                  {
                    left: `${BODY_PARTS[currentPart].x}%`,
                    top: `${BODY_PARTS[currentPart].y}%`,
                    transform: [
                      { translateX: -50 },
                      { translateY: -50 },
                      { scale: partScale },
                    ],
                    opacity: partOpacity,
                  },
                ]}
              >
                <Text style={styles.partEmoji}>{BODY_PARTS[currentPart].emoji}</Text>
                <Text style={styles.partLabel}>{BODY_PARTS[currentPart].label}</Text>
              </Animated.View>
            )}

            {!isVisible && currentPart && !hasTapped && (
              <View style={styles.waitingContainer}>
                <Text style={styles.waitingText}>Tap karo!</Text>
              </View>
            )}

            {!currentPart && (
              <View style={styles.waitingContainer}>
                <Text style={styles.waitingText}>Get ready...</Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {!showFlash && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Fast recognition • Body parts • Reaction time
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the body part quickly when it flashes!
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
    marginBottom: 8,
  },
  progressText: {
    fontSize: 20,
    color: '#8B5CF6',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  flashArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  partContainer: {
    position: 'absolute',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#6366F1',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
    zIndex: 5,
  },
  partEmoji: {
    fontSize: 60,
    marginBottom: 8,
  },
  partLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 24,
    color: '#8B5CF6',
    fontWeight: '800',
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

export default BodyFlashGame;



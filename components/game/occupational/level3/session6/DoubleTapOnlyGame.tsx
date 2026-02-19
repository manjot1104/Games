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
const MAX_TAP_DELAY = 500; // Maximum time between 2 taps (ms)
const CHARACTER_START_Y = SCREEN_HEIGHT * 0.7;
const CHARACTER_JUMP_Y = SCREEN_HEIGHT * 0.4;

const DoubleTapOnlyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showCharacter, setShowCharacter] = useState(false);
  const [hasJumped, setHasJumped] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [singleTapWarning, setSingleTapWarning] = useState(false);

  const characterY = useRef(new Animated.Value(CHARACTER_START_Y)).current;
  const characterScale = useRef(new Animated.Value(1)).current;
  const warningOpacity = useRef(new Animated.Value(0)).current;
  const firstTapTime = useRef<number | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const singleTapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleTap = useCallback(() => {
    if (done || !showCharacter || hasJumped) return;

    const now = Date.now();

    if (firstTapTime.current === null) {
      // First tap - start waiting for second tap
      firstTapTime.current = now;
      setTapCount(1);
      setSingleTapWarning(false);
      
      // If second tap doesn't come in time, show warning
      tapTimeoutRef.current = setTimeout(() => {
        // Single tap detected - ignore it and show warning
        setTapCount(0);
        firstTapTime.current = null;
        setSingleTapWarning(true);
        warningOpacity.setValue(1);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS('Single tap is ignored! Tap twice!', 0.8, 'en-US' );
        
        // Hide warning after 1 second
        singleTapTimeoutRef.current = setTimeout(() => {
          Animated.timing(warningOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }).start(() => {
            setSingleTapWarning(false);
          });
        }, 1000) as unknown as NodeJS.Timeout;
      }, MAX_TAP_DELAY) as unknown as NodeJS.Timeout;

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else {
      // Second tap
      const timeDiff = now - firstTapTime.current;

      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }

      if (timeDiff <= MAX_TAP_DELAY) {
        // Success! Double tap detected
        setTapCount(2);
        handleSuccess();
      } else {
        // Too slow, treat as single tap
        setTapCount(0);
        firstTapTime.current = null;
        setSingleTapWarning(true);
        warningOpacity.setValue(1);
        
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Single tap is ignored! Tap twice quickly!', 0.8, 'en-US' );
        
        singleTapTimeoutRef.current = setTimeout(() => {
          Animated.timing(warningOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }).start(() => {
            setSingleTapWarning(false);
          });
        }, 1000) as unknown as NodeJS.Timeout;
      }
    }
  }, [done, showCharacter, hasJumped, warningOpacity]);

  const handleSuccess = useCallback(() => {
    setHasJumped(true);
    setScore((s) => s + 1);
    firstTapTime.current = null;
    setTapCount(0);
    setSingleTapWarning(false);
    warningOpacity.setValue(0);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect double tap!', 0.9, 'en-US' );
    
    // Jump animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(characterY, {
          toValue: CHARACTER_JUMP_Y,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(characterScale, {
            toValue: 1.3,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(characterScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.timing(characterY, {
        toValue: CHARACTER_START_Y,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowCharacter(false);
        setHasJumped(false);
        characterY.setValue(CHARACTER_START_Y);
        characterScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, characterY, characterScale]);

  const showCharacterObject = useCallback(() => {
    setShowCharacter(true);
    setHasJumped(false);
    setTapCount(0);
    setSingleTapWarning(false);
    firstTapTime.current = null;
    characterY.setValue(CHARACTER_START_Y);
    characterScale.setValue(1);
    warningOpacity.setValue(0);
    
    Animated.spring(characterScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Single tap is ignored! Only double tap will make it jump!', 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS('Single tap ignore hota hai! Sirf double tap se jump hoga!', 0.8 );
    }
  }, [characterScale, characterY, warningOpacity]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showCharacterObject();
    }, 500);
  }, [done, showCharacterObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowCharacter(false);

    try {
      await logGameAndAward({
        type: 'double-tap-only',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['control', 'precision', 'double-tap'],
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
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Double Tap Only"
        emoji="👆"
        description="Single tap is ignored! Only double tap will make it jump!"
        skills={['Control', 'Precision']}
        suitableFor="Children learning control and precision with double tap gestures"
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
            setShowCharacter(false);
            setHasJumped(false);
            setTapCount(0);
            setSingleTapWarning(false);
            characterY.setValue(CHARACTER_START_Y);
            characterScale.setValue(1);
            warningOpacity.setValue(0);
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
        <Text style={styles.title}>Double Tap Only</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👆 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Single tap is ignored! Only double tap to jump!
        </Text>
        {tapCount > 0 && (
          <Text style={styles.tapIndicator}>
            Tap: {tapCount}/2
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showCharacter && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={handleTap}
            style={styles.tapArea}
          >
            <Animated.View
              style={[
                styles.characterContainer,
                {
                  top: characterY,
                  transform: [{ scale: characterScale }],
                },
              ]}
            >
              <Text style={styles.characterEmoji}>🚶</Text>
              <Text style={styles.characterLabel}>DOUBLE TAP</Text>
            </Animated.View>

            {singleTapWarning && (
              <Animated.View
                style={[
                  styles.warningContainer,
                  {
                    opacity: warningOpacity,
                  },
                ]}
              >
                <Text style={styles.warningText}>⚠️ SINGLE TAP IGNORE</Text>
              </Animated.View>
            )}
          </TouchableOpacity>
        )}

        {!showCharacter && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Control • Precision
        </Text>
        <Text style={styles.footerSubtext}>
          Only double tap works! Single tap is ignored - builds control and precision.
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
  tapIndicator: {
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '800',
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
  characterContainer: {
    position: 'absolute',
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -75,
  },
  characterEmoji: {
    fontSize: 120,
    marginBottom: 8,
  },
  characterLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  warningContainer: {
    position: 'absolute',
    top: '40%',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 20,
  },
  warningText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
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

export default DoubleTapOnlyGame;



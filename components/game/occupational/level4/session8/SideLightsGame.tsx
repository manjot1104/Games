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

const TOTAL_ROUNDS = 12;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const LIGHT_SIZE = 120;

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

const SideLightsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [activeSide, setActiveSide] = useState<Side | null>(null);
  const [hasTapped, setHasTapped] = useState(false);

  const leftLightScale = useRef(new Animated.Value(1)).current;
  const rightLightScale = useRef(new Animated.Value(1)).current;
  const leftLightOpacity = useRef(new Animated.Value(0.3)).current;
  const rightLightOpacity = useRef(new Animated.Value(0.3)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showLight = useCallback(() => {
    // Randomly choose left or right
    const side: Side = Math.random() < 0.5 ? 'left' : 'right';
    setActiveSide(side);
    setHasTapped(false);
    
    // Reset scales
    leftLightScale.setValue(1);
    rightLightScale.setValue(1);
    
    // Animate active light
    if (side === 'left') {
      leftLightOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(leftLightOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(leftLightOpacity, {
              toValue: 0.6,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(leftLightOpacity, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      rightLightOpacity.setValue(0.3);
    } else {
      rightLightOpacity.setValue(0.3);
      Animated.sequence([
        Animated.timing(rightLightOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(rightLightOpacity, {
              toValue: 0.6,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(rightLightOpacity, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        ),
      ]).start();
      leftLightOpacity.setValue(0.3);
    }
    
    speak(`Tap ${side} side!`);
    
    // Auto-advance after 3 seconds if not tapped
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (!hasTapped && activeSide === side) {
        handleTimeout();
      }
    }, 3000);
  }, [leftLightOpacity, rightLightOpacity, hasTapped, activeSide]);

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
    
    const lightScale = side === 'left' ? leftLightScale : rightLightScale;
    
    Animated.sequence([
      Animated.timing(lightScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(lightScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Perfect!');
    
    // Fade out active light
    const lightOpacity = side === 'left' ? leftLightOpacity : rightLightOpacity;
    Animated.timing(lightOpacity, {
      toValue: 0.3,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setActiveSide(null);
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          showLight();
        } else {
          endGame();
        }
      }, 500);
    });
  }, [round, leftLightScale, rightLightScale, leftLightOpacity, rightLightOpacity, showLight]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(`Tap ${activeSide} side!`);
    
    // Shake animation
    const wrongScale = activeSide === 'left' ? rightLightScale : leftLightScale;
    Animated.sequence([
      Animated.timing(wrongScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(wrongScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [activeSide, leftLightScale, rightLightScale]);

  const handleTimeout = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak('Too slow!');
    
    setActiveSide(null);
    leftLightOpacity.setValue(0.3);
    rightLightOpacity.setValue(0.3);
    
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showLight();
      } else {
        endGame();
      }
    }, 500);
  }, [hasTapped, round, leftLightOpacity, rightLightOpacity, showLight]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setActiveSide(null);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'side-lights',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['bilateral-activation', 'alternating-sides', 'visual-motor'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        showLight();
      }, 500);
    }
  }, [showInfo, round, done, showLight]);

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

  const leftLightStyle = {
    opacity: leftLightOpacity,
    transform: [{ scale: leftLightScale }],
  };

  const rightLightStyle = {
    opacity: rightLightOpacity,
    transform: [{ scale: rightLightScale }],
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Side Lights"
        emoji="💡"
        description="Left-right lights tap! Bilateral activation!"
        skills={['Bilateral activation', 'Alternating sides']}
        suitableFor="Children learning bilateral coordination and alternating side tapping"
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
            leftLightOpacity.setValue(0.3);
            rightLightOpacity.setValue(0.3);
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
        <Text style={styles.title}>Side Lights</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {activeSide ? `Tap ${activeSide} side!` : 'Wait for light...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        <View style={styles.lightsContainer}>
          <TouchableOpacity
            style={styles.lightButton}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.light, styles.leftLight, leftLightStyle]}>
              <Text style={styles.lightEmoji}>💡</Text>
              <Text style={styles.lightLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.lightButton}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.light, styles.rightLight, rightLightStyle]}>
              <Text style={styles.lightEmoji}>💡</Text>
              <Text style={styles.lightLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Bilateral activation • Alternating sides
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
  lightsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  lightButton: {
    width: LIGHT_SIZE,
    height: LIGHT_SIZE,
  },
  light: {
    width: LIGHT_SIZE,
    height: LIGHT_SIZE,
    borderRadius: LIGHT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftLight: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightLight: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  lightEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  lightLabel: {
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

export default SideLightsGame;

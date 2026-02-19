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
    PanResponder,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWING_START_X_PCT = 20;
const SWING_END_X_PCT = 80;
const SWING_START_Y_PCT = 30;
const SWING_END_Y_PCT = 70;
const MIN_SWING_DISTANCE = 200; // Minimum swipe distance for a swing

const MonkeySwingGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showMonkey, setShowMonkey] = useState(false);
  const [hasSwung, setHasSwung] = useState(false);
  const [swingCount, setSwingCount] = useState(0);

  const monkeyX = useRef(new Animated.Value(SWING_START_X_PCT)).current;
  const monkeyY = useRef(new Animated.Value(SWING_START_Y_PCT)).current;
  const monkeyScale = useRef(new Animated.Value(1)).current;
  const monkeyRotation = useRef(new Animated.Value(0)).current;
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (done || !showMonkey || hasSwung) return;
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        if (done || !showMonkey || hasSwung) return;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Move monkey along swipe direction (diagonal swing)
        const newXPct = ((swipeStartX.current + deltaX) / SCREEN_WIDTH) * 100;
        const newYPct = ((swipeStartY.current + deltaY) / SCREEN_HEIGHT) * 100;
        
        monkeyX.setValue(Math.max(10, Math.min(90, newXPct)));
        monkeyY.setValue(Math.max(20, Math.min(80, newYPct)));
        
        // Rotate monkey based on swing direction
        const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
        monkeyRotation.setValue(angle);
      },
      onPanResponderRelease: (evt) => {
        if (done || !showMonkey || hasSwung) return;
        
        const distance = swipeDistance.current;
        
        if (distance >= MIN_SWING_DISTANCE) {
          // Successful swing!
          setSwingCount((c) => c + 1);
          
          if (swingCount + 1 >= 2) {
            // Completed required swings
            handleSuccess();
          } else {
            // One more swing needed
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            speakTTS('Ek aur swing karo!', 0.8 );
            
            // Reset position for next swing
            setTimeout(() => {
              monkeyX.setValue(SWING_START_X_PCT);
              monkeyY.setValue(SWING_START_Y_PCT);
              monkeyRotation.setValue(0);
            }, 500);
          }
        } else {
          // Not enough distance
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Zada swing karo! Liana pe swing karna hai!', 0.8 );
          
          // Reset position
          Animated.parallel([
            Animated.spring(monkeyX, {
              toValue: SWING_START_X_PCT,
              damping: 10,
              stiffness: 100,
              useNativeDriver: false,
            }),
            Animated.spring(monkeyY, {
              toValue: SWING_START_Y_PCT,
              damping: 10,
              stiffness: 100,
              useNativeDriver: false,
            }),
            Animated.spring(monkeyRotation, {
              toValue: 0,
              damping: 10,
              stiffness: 100,
              useNativeDriver: true,
            }),
          ]).start();
        }
      },
    })
  ).current;

  const showMonkeyObject = useCallback(() => {
    setShowMonkey(true);
    setHasSwung(false);
    setSwingCount(0);
    monkeyX.setValue(SWING_START_X_PCT);
    monkeyY.setValue(SWING_START_Y_PCT);
    monkeyRotation.setValue(0);
    monkeyScale.setValue(1);
    
    Animated.spring(monkeyScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    speakTTS('Monkey ko liana pe swing karao! Do baar swing karo!', 0.8 );
  }, [monkeyScale, monkeyX, monkeyY, monkeyRotation]);

  const handleSuccess = useCallback(() => {
    setHasSwung(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect monkey swing!', 0.9 );
    
    // Success animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(monkeyScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(monkeyX, {
          toValue: SWING_END_X_PCT,
          duration: 400,
          useNativeDriver: false,
        }),
      ]),
      Animated.timing(monkeyScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowMonkey(false);
        setHasSwung(false);
        setSwingCount(0);
        monkeyX.setValue(SWING_START_X_PCT);
        monkeyY.setValue(SWING_START_Y_PCT);
        monkeyRotation.setValue(0);
        monkeyScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, monkeyX, monkeyY, monkeyScale, monkeyRotation]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showMonkeyObject();
    }, 500);
  }, [done, showMonkeyObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowMonkey(false);

    try {
      await logGameAndAward({
        type: 'monkey-swing',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['whole-arm-movement', 'swinging-motion'],
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
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Monkey Swing"
        emoji="🐵"
        description="Liana pe swing karo! Monkey ko diagonal swing karao!"
        skills={['Whole arm movement', 'Swinging motion']}
        suitableFor="Children learning whole arm movement and swinging gestures"
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
            setShowMonkey(false);
            setHasSwung(false);
            setSwingCount(0);
            monkeyX.setValue(SWING_START_X_PCT);
            monkeyY.setValue(SWING_START_Y_PCT);
            monkeyRotation.setValue(0);
            monkeyScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
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
        <Text style={styles.title}>Monkey Swing</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🐵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Monkey ko liana pe swing karao! Do baar swing karo!
        </Text>
        {swingCount > 0 && (
          <Text style={styles.swingIndicator}>
            Swings: {swingCount}/2
          </Text>
        )}
      </View>

      <View style={styles.gameArea}>
        {showMonkey && (
          <>
            {/* Liana/rope */}
            <View style={styles.lianaContainer}>
              <View style={styles.liana} />
            </View>

            <Animated.View
              style={[
                styles.monkeyContainer,
                {
                  left: monkeyX.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  top: monkeyY.interpolate({
                    inputRange: [0, 100],
                    outputRange: ['0%', '100%'],
                  }),
                  transform: [
                    { translateX: -40 },
                    { translateY: -40 },
                    { rotate: monkeyRotation.interpolate({
                      inputRange: [-180, 180],
                      outputRange: ['-180deg', '180deg'],
                    }) },
                    { scale: monkeyScale },
                  ],
                },
              ]}
            >
              <Text style={styles.monkeyEmoji}>🐵</Text>
            </Animated.View>
          </>
        )}

        {!showMonkey && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Whole arm movement • Swinging motion
        </Text>
        <Text style={styles.footerSubtext}>
          Swing the monkey diagonally like on a liana!
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
    color: '#F59E0B',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  swingIndicator: {
    fontSize: 20,
    color: '#F59E0B',
    fontWeight: '800',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  lianaContainer: {
    position: 'absolute',
    top: '25%',
    left: '50%',
    width: 4,
    height: '50%',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateX: -2 }],
  },
  liana: {
    width: 4,
    height: '100%',
    backgroundColor: '#78716C',
    borderRadius: 2,
  },
  monkeyContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  monkeyEmoji: {
    fontSize: 70,
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

export default MonkeySwingGame;



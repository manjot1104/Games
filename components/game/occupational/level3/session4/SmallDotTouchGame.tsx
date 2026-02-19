import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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

const TOTAL_ROUNDS = 12;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SMALL_DOT_SIZE = 20; // Very small dot

const SmallDotTouchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showTarget, setShowTarget] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);
  const [dotPosition, setDotPosition] = useState({ x: 0, y: 0 });

  const dotScale = useRef(new Animated.Value(0)).current;
  const dotOpacity = useRef(new Animated.Value(0)).current;
  const dotGlow = useRef(new Animated.Value(0.5)).current;

  const getRandomPosition = useCallback(() => {
    const margin = SMALL_DOT_SIZE + 20;
    const x = margin + Math.random() * (SCREEN_WIDTH - margin * 2);
    const y = margin + Math.random() * (SCREEN_HEIGHT - margin * 2 - 200); // Account for header
    return { x, y };
  }, []);

  const showDot = useCallback(() => {
    const pos = getRandomPosition();
    setDotPosition(pos);
    setShowTarget(true);
    setHasTapped(false);
    
    Animated.parallel([
      Animated.spring(dotScale, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(dotOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(dotGlow, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(dotGlow, {
            toValue: 0.5,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Find and touch the small dot!', 0.8 );
      }, 300);
    } else {
      speakTTS('Find and touch the small dot!', 0.8 );
    }
  }, [dotScale, dotOpacity, dotGlow, getRandomPosition]);

  const handleTap = useCallback(() => {
    if (showTarget && !hasTapped && !done) {
      setHasTapped(true);
      setScore((s) => s + 1);
      
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      
      Animated.parallel([
        Animated.timing(dotScale, {
          toValue: 2,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowTarget(false);
          dotScale.setValue(0);
          dotOpacity.setValue(0);
          dotGlow.setValue(0.5);
        } else {
          endGame();
        }
      }, 500);
    }
  }, [showTarget, hasTapped, done, round, dotScale, dotOpacity]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showDot();
    }, 500);
  }, [done, showDot]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      await logGameAndAward({
        type: 'small-dot-touch',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['precision', 'finger-control'],
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
        title="Small Dot Touch"
        emoji="👆"
        description="Touch the small dot on screen"
        skills={['Precision', 'Finger control']}
        suitableFor="Children who want to develop precision and finger control"
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
            setShowTarget(false);
            setHasTapped(false);
            dotScale.setValue(0);
            dotOpacity.setValue(0);
            dotGlow.setValue(0.5);
          }}
        />
      </SafeAreaView>
    );
  }

  const glowOpacity = dotGlow.interpolate({
    inputRange: [0.5, 1],
    outputRange: [0.3, 0.8],
  });

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            stopTTS();
          } catch (e) {
            // Ignore errors
          }
          stopAllSpeech();
          cleanupSounds();
          if (onBack) onBack();
        }}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>👆 Small Dot Touch</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea}>
        {showTarget && (
          <TouchableOpacity
            onPress={handleTap}
            style={[
              styles.smallDot,
              {
                left: dotPosition.x - SMALL_DOT_SIZE / 2,
                top: dotPosition.y - SMALL_DOT_SIZE / 2,
              },
            ]}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <Animated.View
              style={[
                styles.dotInner,
                {
                  transform: [{ scale: dotScale }],
                  opacity: dotOpacity,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.dotGlow,
                  {
                    opacity: glowOpacity,
                  },
                ]}
              />
            </Animated.View>
          </TouchableOpacity>
        )}
        
        {!showTarget && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Looking for the dot... 👀</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  header: {
    paddingTop: 100,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
  },
  smallDot: {
    position: 'absolute',
    width: SMALL_DOT_SIZE,
    height: SMALL_DOT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: {
    width: SMALL_DOT_SIZE,
    height: SMALL_DOT_SIZE,
    borderRadius: SMALL_DOT_SIZE / 2,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  dotGlow: {
    position: 'absolute',
    width: SMALL_DOT_SIZE * 2,
    height: SMALL_DOT_SIZE * 2,
    borderRadius: SMALL_DOT_SIZE,
    backgroundColor: '#DC2626',
  },
  waitingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#92400E',
  },
});

export default SmallDotTouchGame;





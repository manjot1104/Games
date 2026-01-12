import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
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
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BIG_SIZE = 200;
const SMALL_SIZE = 60;

type ObjectSize = 'big' | 'small';

const BigSmallSwitchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentSize, setCurrentSize] = useState<ObjectSize>('big');
  const [showTarget, setShowTarget] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);

  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;

  const showObject = useCallback(() => {
    // Randomly choose big or small
    const size: ObjectSize = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentSize(size);
    setShowTarget(true);
    setHasTapped(false);
    
    Animated.parallel([
      Animated.spring(objectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(size === 'big' ? 'BIG object! Tap it!' : 'SMALL object! Tap it!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(size === 'big' ? 'BIG object! Tap it!' : 'SMALL object! Tap it!', { rate: 0.8 });
    }
  }, [objectScale, objectOpacity]);

  const handleTap = useCallback(() => {
    if (showTarget && !hasTapped && !done) {
      setHasTapped(true);
      setScore((s) => s + 1);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      
      Animated.parallel([
        Animated.timing(objectScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(objectOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          setShowTarget(false);
          objectScale.setValue(0);
          objectOpacity.setValue(0);
        } else {
          endGame();
        }
      }, 500);
    }
  }, [showTarget, hasTapped, done, round, objectScale, objectOpacity]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showObject();
    }, 500);
  }, [done, showObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      await logGameAndAward({
        type: 'big-small-switch',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['size-differentiation', 'visual-motor-skills'],
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
        Speech.stop();
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
        title="Big-Small Switch"
        emoji="🔄"
        description="Sometimes big, sometimes small object appears on screen"
        skills={['Size differentiation', 'Visual-motor skills']}
        suitableFor="Children who want to develop size differentiation and visual-motor skills"
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
            objectScale.setValue(0);
            objectOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const objectSize = currentSize === 'big' ? BIG_SIZE : SMALL_SIZE;
  const colors = currentSize === 'big' 
    ? ['#3B82F6', '#2563EB'] 
    : ['#F59E0B', '#D97706'];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            Speech.stop();
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
        <Text style={styles.title}>🔄 Big-Small Switch</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea}>
        {showTarget && (
          <TouchableOpacity
            onPress={handleTap}
            activeOpacity={0.9}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  width: objectSize,
                  height: objectSize,
                  borderRadius: objectSize / 2,
                  transform: [{ scale: objectScale }],
                  opacity: objectOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={colors}
                style={styles.objectGradient}
              >
                <Text style={[styles.sizeText, { fontSize: currentSize === 'big' ? 48 : 24 }]}>
                  {currentSize === 'big' ? 'BIG' : 'SMALL'}
                </Text>
              </LinearGradient>
            </Animated.View>
          </TouchableOpacity>
        )}
        
        {!showTarget && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready... 👀</Text>
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
    color: '#065F46',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#047857',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  object: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  sizeText: {
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
  },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#047857',
  },
});

export default BigSmallSwitchGame;





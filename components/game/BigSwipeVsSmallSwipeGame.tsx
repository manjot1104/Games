import { logGameAndAward } from '@/utils/api';
import { stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;
const BIG_SWIPE_THRESHOLD = 200; // Minimum distance for big swipe
const SMALL_SWIPE_THRESHOLD = 50; // Maximum distance for small swipe

type GamePhase = 'idle' | 'playing' | 'finished';
type SwipeType = 'big' | 'small';

export const BigSwipeVsSmallSwipeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [targetSwipe, setTargetSwipe] = useState<SwipeType | null>(null);
  const [bigBarProgress, setBigBarProgress] = useState(0);
  const [smallBarProgress, setSmallBarProgress] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const bigBarAnim = useRef(new Animated.Value(0)).current;
  const smallBarAnim = useRef(new Animated.Value(0)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllSpeech();
    };
  }, []);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => phase === 'playing',
    onMoveShouldSetPanResponder: () => phase === 'playing',
    onPanResponderGrant: (evt) => {
      swipeStartRef.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
    },
    onPanResponderRelease: (evt) => {
      if (!swipeStartRef.current || !targetSwipe) return;

      const endX = evt.nativeEvent.pageX;
      const endY = evt.nativeEvent.pageY;
      const distance = Math.sqrt(
        Math.pow(endX - swipeStartRef.current.x, 2) + Math.pow(endY - swipeStartRef.current.y, 2)
      );

      if (targetSwipe === 'big' && distance >= BIG_SWIPE_THRESHOLD) {
        // Correct big swipe
        setCorrect((c) => c + 1);
        Animated.timing(bigBarAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }).start();
        setBigBarProgress(100);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Great! Big swipe!');
      } else if (targetSwipe === 'small' && distance <= SMALL_SWIPE_THRESHOLD && distance > 10) {
        // Correct small swipe
        setCorrect((c) => c + 1);
        Animated.timing(smallBarAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: false,
        }).start();
        setSmallBarProgress(100);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect! Small swipe!');
      } else {
        // Wrong swipe
        setWrong((w) => w + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Try again!');
      }

      // Reset and move to next round
      setTimeout(() => {
        resetBars();
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          generateTarget();
        } else {
          finishGame();
        }
      }, 1500);
    },
  });

  const resetBars = () => {
    bigBarAnim.setValue(0);
    smallBarAnim.setValue(0);
    setBigBarProgress(0);
    setSmallBarProgress(0);
  };

  const generateTarget = () => {
    const swipeType: SwipeType = Math.random() > 0.5 ? 'big' : 'small';
    setTargetSwipe(swipeType);
    speakTTS(swipeType === 'big' ? 'Make a BIG swipe!' : 'Make a SMALL swipe!');
  };

  const startGame = () => {
    setPhase('playing');
    setRound(1);
    setCorrect(0);
    setWrong(0);
    resetBars();
    generateTarget();
  };

  const finishGame = async () => {
    setPhase('finished');
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 15;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'big-swipe-vs-small-swipe',
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['movement-range', 'motor-control', 'spatial-awareness'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You mastered big and small swipes!');
  };

  const bigBarWidth = bigBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const smallBarWidth = smallBarAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Results screen
  if (phase === 'finished' && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => {
            stopAllSpeech();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.resultsContainer}>
          <Text style={styles.emoji}>👆</Text>
          <Text style={styles.title}>Swipe Game Complete!</Text>
          <Text style={styles.subtitle}>You mastered big and small swipes!</Text>

          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={finalStats.accuracy}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setPhase('idle');
              setFinalStats(null);
              setLogTimestamp(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Game screen
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.headerText}>Round {round} / {TOTAL_ROUNDS}</Text>
        <Text style={styles.scoreText}>Correct: {correct}</Text>
      </View>

      {phase === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>👆</Text>
          <Text style={styles.title}>Big Swipe vs Small Swipe</Text>
          <Text style={styles.instructions}>
            Swipe long to fill the BIG bar{'\n'}
            Swipe short to fill the SMALL bar{'\n'}
            Match the target!
          </Text>
          <TouchableOpacity style={styles.startButton} onPress={startGame}>
            <LinearGradient
              colors={['#8B5CF6', '#6366F1']}
              style={styles.startButtonGradient}
            >
              <Text style={styles.startButtonText}>Start Game</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.gameArea} {...panResponder.panHandlers}>
          <View style={styles.targetIndicator}>
            <Text style={styles.targetText}>
              {targetSwipe === 'big' ? 'BIG SWIPE!' : 'SMALL SWIPE!'}
            </Text>
          </View>

          <View style={styles.barsContainer}>
            <View style={styles.barSection}>
              <Text style={styles.barLabel}>BIG BAR</Text>
              <View style={styles.bigBarContainer}>
                <Animated.View
                  style={[
                    styles.bigBarFill,
                    {
                      width: bigBarWidth,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#EF4444', '#DC2626']}
                    style={styles.barGradient}
                  />
                </Animated.View>
              </View>
            </View>

            <View style={styles.barSection}>
              <Text style={styles.barLabel}>SMALL BAR</Text>
              <View style={styles.smallBarContainer}>
                <Animated.View
                  style={[
                    styles.smallBarFill,
                    {
                      width: smallBarWidth,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#6366F1', '#4F46E5']}
                    style={styles.barGradient}
                  />
                </Animated.View>
              </View>
            </View>
          </View>

          <View style={styles.swipeArea}>
            <Text style={styles.swipeHint}>
              {targetSwipe === 'big'
                ? 'Swipe LONG across the screen!'
                : 'Swipe SHORT - just a little!'}
            </Text>
            <View style={styles.swipeZone}>
              <Text style={styles.swipeZoneText}>SWIPE HERE</Text>
            </View>
          </View>
        </View>
      )}
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
    left: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingTop: 80,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  startButton: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  startButtonGradient: {
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    padding: 24,
  },
  targetIndicator: {
    backgroundColor: '#F3F4F6',
    padding: 20,
    borderRadius: 20,
    marginBottom: 32,
    borderWidth: 3,
    borderColor: '#8B5CF6',
  },
  targetText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#8B5CF6',
    textAlign: 'center',
    letterSpacing: 2,
  },
  barsContainer: {
    marginBottom: 32,
    gap: 24,
  },
  barSection: {
    gap: 8,
  },
  barLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  bigBarContainer: {
    height: 60,
    backgroundColor: '#E5E7EB',
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#EF4444',
  },
  smallBarContainer: {
    height: 40,
    backgroundColor: '#E5E7EB',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#6366F1',
  },
  bigBarFill: {
    height: '100%',
    borderRadius: 30,
    overflow: 'hidden',
  },
  smallBarFill: {
    height: '100%',
    borderRadius: 20,
    overflow: 'hidden',
  },
  barGradient: {
    width: '100%',
    height: '100%',
  },
  swipeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeHint: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 24,
    textAlign: 'center',
  },
  swipeZone: {
    width: '100%',
    height: 200,
    backgroundColor: '#F3F4F6',
    borderRadius: 24,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeZoneText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  resultsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
});



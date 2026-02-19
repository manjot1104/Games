import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring
} from 'react-native-reanimated';
import { SparkleBurst } from './FX';
import ResultCard from './ResultCard';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const RESET_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const TRAIN_SIZE = 70;
const STATION_SIZE = 100;
const TOLERANCE = 50;

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const TrainTrackLineGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playReset = useSoundEffect(RESET_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isHorizontal, setIsHorizontal] = useState(true);

  const trainX = useSharedValue(15);
  const trainY = useSharedValue(50);
  const trainScale = useSharedValue(1);
  const stationX = useSharedValue(85);
  const stationY = useSharedValue(50);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      // Stop all speech when game ends
      stopAllSpeech();

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'trainTrackLine',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['directionality', 'start-end-awareness', 'hand-stability', 'straight-line-tracing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log train track line game:', e);
      }

      speakTTS('Great job!', 0.78);
    },
    [router],
  );

  const panGesture = Gesture.Pan()
    .onStart((e) => {
      if (!roundActive || done) return;
      
      // Check if touch started on the train - only allow dragging if started on train
      const touchX = (e.x / screenWidth.current) * 100;
      const touchY = (e.y / screenHeight.current) * 100;
      
      // Calculate distance from touch point to train center
      const trainCenterX = trainX.value;
      const trainCenterY = trainY.value;
      
      // Convert TRAIN_SIZE from pixels to percentage for comparison
      const trainSizePercentX = (TRAIN_SIZE / screenWidth.current) * 100;
      const trainSizePercentY = (TRAIN_SIZE / screenHeight.current) * 100;
      const trainRadiusX = trainSizePercentX / 2;
      const trainRadiusY = trainSizePercentY / 2;
      
      // Check if touch is within train bounds (circular/rectangular area)
      const distX = Math.abs(touchX - trainCenterX);
      const distY = Math.abs(touchY - trainCenterY);
      const isOnTrain = distX <= trainRadiusX && distY <= trainRadiusY;
      
      if (!isOnTrain) {
        return; // Don't start dragging if not on train
      }
      
      setIsDragging(true);
      trainScale.value = withSpring(1.2, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done || !isDragging) return; // Only update if dragging started on train
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      if (isHorizontal) {
        trainX.value = Math.max(5, Math.min(95, newX));
        trainY.value = startY.value; // Keep on track
      } else {
        trainX.value = startX.value; // Keep on track
        trainY.value = Math.max(10, Math.min(90, newY));
      }
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      trainScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      const distance = Math.sqrt(
        Math.pow(trainX.value - stationX.value, 2) + Math.pow(trainY.value - stationY.value, 2)
      );

      if (distance <= TOLERANCE) {
        sparkleX.value = stationX.value;
        sparkleY.value = stationY.value;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              trainX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
              trainY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        trainX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
        trainY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });

        try {
          playReset();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Drag the train to the station!', 0.78);
        } catch {}
      }
    });

  useEffect(() => {
    const horizontal = Math.random() > 0.5;
    setIsHorizontal(horizontal);
    
    if (horizontal) {
      const startXPos = 10 + Math.random() * 10;
      const yPos = 40 + Math.random() * 20;
      startX.value = startXPos;
      startY.value = yPos;
      trainX.value = startXPos;
      trainY.value = yPos;
      stationX.value = 80 + Math.random() * 15;
      stationY.value = yPos;
    } else {
      const xPos = 40 + Math.random() * 20;
      const startYPos = 10 + Math.random() * 10;
      startX.value = xPos;
      startY.value = startYPos;
      trainX.value = xPos;
      trainY.value = startYPos;
      stationX.value = xPos;
      stationY.value = 75 + Math.random() * 15;
    }

    try {
      speakTTS('Drag the train along the track to the station!', 0.78);
    } catch {}

    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const trainStyle = useAnimatedStyle(() => ({
    left: `${trainX.value}%`,
    top: `${trainY.value}%`,
    transform: [
      { translateX: -TRAIN_SIZE / 2 },
      { translateY: -TRAIN_SIZE / 2 },
      { scale: trainScale.value },
    ],
  }));

  const stationStyle = useAnimatedStyle(() => ({
    left: `${stationX.value}%`,
    top: `${stationY.value}%`,
    transform: [
      { translateX: -STATION_SIZE / 2 },
      { translateY: -STATION_SIZE / 2 },
    ],
  }));

  const trackStyle = useAnimatedStyle(() => {
    if (isHorizontal) {
      return {
        position: 'absolute',
        left: `${Math.min(startX.value, stationX.value)}%`,
        top: `${startY.value}%`,
        width: `${Math.abs(stationX.value - startX.value)}%`,
        height: 8,
        transform: [{ translateY: -4 }],
        backgroundColor: '#8B4513',
      };
    } else {
      return {
        position: 'absolute',
        left: `${startX.value}%`,
        top: `${Math.min(startY.value, stationY.value)}%`,
        width: 8,
        height: `${Math.abs(stationY.value - startY.value)}%`,
        transform: [{ translateX: -4 }],
        backgroundColor: '#8B4513',
      };
    }
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🚂</Text>
            <Text style={styles.resultTitle}>Train master!</Text>
            <Text style={styles.resultSubtitle}>
              You completed {finalStats.correct} tracks out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setRoundActive(true);
                trainX.value = startX.value;
                trainY.value = startY.value;
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Train Track Line</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚂 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Drag the train from start to station along the track!
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.track, trackStyle]} />
            
            <Animated.View style={[styles.stationContainer, stationStyle]}>
              <View style={styles.station}>
                <Text style={styles.stationEmoji}>🏁</Text>
              </View>
            </Animated.View>

            <Animated.View style={[styles.trainContainer, trainStyle]}>
              <View style={styles.train}>
                <Text style={styles.trainEmoji}>🚂</Text>
              </View>
            </Animated.View>

            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: directionality • start-end awareness • hand stability
        </Text>
        <Text style={styles.footerSub}>
          Drag the train along the straight track to build directionality and hand control!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  track: {
    borderRadius: 4,
    zIndex: 1,
  },
  trainContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  train: {
    width: TRAIN_SIZE,
    height: TRAIN_SIZE,
    borderRadius: TRAIN_SIZE / 2,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  trainEmoji: {
    fontSize: 40,
  },
  stationContainer: {
    position: 'absolute',
    zIndex: 2,
  },
  station: {
    width: STATION_SIZE,
    height: STATION_SIZE,
    borderRadius: 12,
    backgroundColor: '#22C55E',
    borderWidth: 4,
    borderColor: '#16A34A',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  stationEmoji: {
    fontSize: 50,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default TrainTrackLineGame;


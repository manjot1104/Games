import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const TOTAL_ROUNDS = 8;
const ANIMAL_SIZE = 70;
const HOME_SIZE = 100;
const HOME_TOLERANCE = 50;

type AnimalType = 'cat' | 'bee' | 'turtle';
type HomeType = 'house' | 'hive' | 'pond';

const ANIMAL_EMOJIS: Record<AnimalType, string> = {
  cat: '🐱',
  bee: '🐝',
  turtle: '🐢',
};

const HOME_EMOJIS: Record<HomeType, string> = {
  house: '🏠',
  hive: '🍯',
  pond: '🌊',
};

const ANIMAL_HOME_MAP: Record<AnimalType, HomeType> = {
  cat: 'house',
  bee: 'hive',
  turtle: 'pond',
};

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

const DragAnimalHomeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [animalType, setAnimalType] = useState<AnimalType>('cat');
  const [homeType, setHomeType] = useState<HomeType>('house');

  // Animation values
  const animalX = useSharedValue(20);
  const animalY = useSharedValue(50);
  const animalScale = useSharedValue(1);
  const homeX = useSharedValue(80);
  const homeY = useSharedValue(50);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(20);
  const startY = useSharedValue(50);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful drag
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'dragAnimalHome',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['directional-drag', 'sequencing', 'visual-motor-matching', 'spatial-planning'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log drag animal home game:', e);
      }

      speakTTS('All animals are home!', 0.78 );
    },
    [router],
  );

  // Pan gesture for dragging
  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!roundActive || done) return;
      setIsDragging(true);
      animalScale.value = withSpring(1.3, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done) return;
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      animalX.value = Math.max(5, Math.min(95, newX));
      animalY.value = Math.max(10, Math.min(90, newY));
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      animalScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      // Check if animal is at home
      const distance = Math.sqrt(
        Math.pow(animalX.value - homeX.value, 2) + Math.pow(animalY.value - homeY.value, 2)
      );

      if (distance <= HOME_TOLERANCE) {
        // Success!
        sparkleX.value = homeX.value;
        sparkleY.value = homeY.value;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              // Reset animal position
              animalX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
              animalY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });
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
        // Return to start
        animalX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
        animalY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS(`Drag the ${animalType} to its home!`, 0.78 );
        } catch {}
      }
    });

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Drag the animal to its home! Match the animal with its home.', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Initialize round
  useEffect(() => {
    // Random animal type
    const animals: AnimalType[] = ['cat', 'bee', 'turtle'];
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    setAnimalType(randomAnimal);
    setHomeType(ANIMAL_HOME_MAP[randomAnimal]);

    // Random positions
    const animalXPos = 15 + Math.random() * 10; // 15-25%
    const animalYPos = 40 + Math.random() * 20; // 40-60%
    startX.value = animalXPos;
    startY.value = animalYPos;
    animalX.value = animalXPos;
    animalY.value = animalYPos;

    const homeXPos = 70 + Math.random() * 15; // 70-85%
    const homeYPos = 30 + Math.random() * 40; // 30-70%
    homeX.value = homeXPos;
    homeY.value = homeYPos;
  }, [round, startX, startY, animalX, animalY, homeX, homeY]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const animalStyle = useAnimatedStyle(() => ({
    left: `${animalX.value}%`,
    top: `${animalY.value}%`,
    transform: [
      { translateX: -ANIMAL_SIZE / 2 },
      { translateY: -ANIMAL_SIZE / 2 },
      { scale: animalScale.value },
    ],
  }));

  const homeStyle = useAnimatedStyle(() => ({
    left: `${homeX.value}%`,
    top: `${homeY.value}%`,
    transform: [
      { translateX: -HOME_SIZE / 2 },
      { translateY: -HOME_SIZE / 2 },
    ],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Result screen
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🏠</Text>
            <Text style={styles.resultTitle}>All animals home!</Text>
            <Text style={styles.resultSubtitle}>
              You helped {finalStats.correct} animals reach home out of {finalStats.total}!
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
                animalX.value = startX.value;
                animalY.value = startY.value;
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
        <Text style={styles.title}>Drag The Animal Home</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • {ANIMAL_EMOJIS[animalType]} Score: {score}
        </Text>
        <Text style={styles.helper}>
          Drag the {animalType} to its home! Match the animal with its home.
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
            {/* Home */}
            <Animated.View style={[styles.homeContainer, homeStyle]}>
              <View style={styles.homeBox}>
                <Text style={styles.homeEmoji}>{HOME_EMOJIS[homeType]}</Text>
                <Text style={styles.homeLabel}>HOME</Text>
              </View>
            </Animated.View>

            {/* Animal */}
            <Animated.View style={[styles.animalContainer, animalStyle]}>
              <View style={styles.animal}>
                <Text style={styles.animalEmoji}>{ANIMAL_EMOJIS[animalType]}</Text>
              </View>
            </Animated.View>

            {/* Sparkle burst on success */}
            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {/* Instruction */}
            {!isDragging && (
              <View style={styles.instructionBox}>
                <Text style={styles.instructionText}>
                  Drag {ANIMAL_EMOJIS[animalType]} to {HOME_EMOJIS[homeType]}! 👆
                </Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: directional drag • sequencing • visual-motor matching • spatial planning
        </Text>
        <Text style={styles.footerSub}>
          Match each animal with its home! This builds spatial awareness and planning.
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
  animalContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  animal: {
    width: ANIMAL_SIZE,
    height: ANIMAL_SIZE,
    borderRadius: ANIMAL_SIZE / 2,
    backgroundColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  animalEmoji: {
    fontSize: 50,
  },
  homeContainer: {
    position: 'absolute',
    zIndex: 2,
  },
  homeBox: {
    width: HOME_SIZE,
    height: HOME_SIZE,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    borderWidth: 4,
    borderColor: '#FCD34D',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  homeEmoji: {
    fontSize: 50,
  },
  homeLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 4,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  instructionBox: {
    position: 'absolute',
    top: '75%',
    left: '50%',
    transform: [{ translateX: -100 }],
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
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

export default DragAnimalHomeGame;


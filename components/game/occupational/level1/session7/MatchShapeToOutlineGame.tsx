import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const OUTLINE_SIZE = 140;
const SHAPE_SIZE = 100;

type ShapeType = 'circle' | 'triangle';

const SHAPE_EMOJIS: Record<ShapeType, string> = {
  circle: '⭕',
  triangle: '▲',
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

const MatchShapeToOutlineGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [targetOutline, setTargetOutline] = useState<ShapeType | null>(null);
  const [outlines, setOutlines] = useState<ShapeType[]>([]);
  const [shapes, setShapes] = useState<Array<{ type: ShapeType; x: number; y: number; scale: Animated.Value; shakeAnim: Animated.Value }>>([]);
  const [isShaking, setIsShaking] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 15; // 15 XP per correct match
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'matchShapeToOutline' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['spatial-reasoning', 'early-puzzle-foundation', 'visual-form-constancy'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log match shape to outline game:', e);
      }

      speakTTS('Great job!', 0.78 );
    },
    [router],
  );

  // Generate random positions for shapes
  const generateShapePositions = useCallback((): { x: number; y: number }[] => {
    const margin = 20;
    const positions: { x: number; y: number }[] = [];
    
    // Generate 2 positions that don't overlap
    let attempts = 0;
    while (positions.length < 2 && attempts < 50) {
      const x = margin + Math.random() * (100 - margin * 2);
      const y = margin + Math.random() * (100 - margin * 2);
      
      let valid = true;
      for (const pos of positions) {
        const dx = pos.x - x;
        const dy = pos.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 25) {
          valid = false;
          break;
        }
      }
      
      if (valid) {
        positions.push({ x, y });
      }
      attempts++;
    }
    
    // Fallback positions
    if (positions.length < 2) {
      return [
        { x: 30, y: 40 },
        { x: 70, y: 60 },
      ];
    }
    
    return positions;
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    // Generate 2 outlines (circle and triangle)
    const allTypes: ShapeType[] = ['circle', 'triangle'];
    const shuffledOutlines = [...allTypes].sort(() => Math.random() - 0.5);
    setOutlines(shuffledOutlines);
    
    // Randomly select target outline
    const newTarget = shuffledOutlines[Math.floor(Math.random() * shuffledOutlines.length)];
    setTargetOutline(newTarget);
    
    // Generate 2 shapes (one matching, one different)
    const otherType = newTarget === 'circle' ? 'triangle' : 'circle';
    const shapeTypes: ShapeType[] = [newTarget, otherType];
    const shuffledTypes = [...shapeTypes].sort(() => Math.random() - 0.5);
    
    const positions = generateShapePositions();
    const newShapes = shuffledTypes.map((type, index) => ({
      type,
      x: positions[index]?.x || 50,
      y: positions[index]?.y || 50,
      scale: new Animated.Value(1),
      shakeAnim: new Animated.Value(0),
    }));
    
    setShapes(newShapes);
    setRoundActive(true);
    setIsShaking(false);
  }, [generateShapePositions]);

  // Handle shape tap
  const handleShapeTap = useCallback(
    async (index: number) => {
      if (!roundActive || done || isShaking) return;

      const shape = shapes[index];
      if (!shape || !targetOutline) return;

      const isCorrect = shape.type === targetOutline;

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
        Animated.sequence([
          Animated.timing(shape.scale, {
            toValue: 1.3,
            duration: 120,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.scale, {
            toValue: 0,
            duration: 150,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}

        setScore((s) => s + 1);

        // Next round or finish
        if (round >= TOTAL_ROUNDS) {
          endGame(score + 1);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 400);
          }, 600);
        }
      } else {
        // Wrong tap - shake animation
        setIsShaking(true);
        Animated.sequence([
          Animated.timing(shape.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: -10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: 0,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start(() => {
          setIsShaking(false);
        });

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Try the matching shape!', 0.78 );
        } catch {}

        // Retry - don't advance round
      }
    },
    [roundActive, done, isShaking, shapes, targetOutline, round, score, startRound, endGame, playSuccess, playError],
  );

  // Start first round
  useEffect(() => {
    if (!done) {
      startRound();
    }
  }, []);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Match the shape to the outline!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🧩</Text>
            <Text style={styles.resultTitle}>Puzzle master!</Text>
            <Text style={styles.resultSubtitle}>
              You matched {finalStats.correct} shapes out of {finalStats.total}!
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
                startRound();
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
        <Text style={styles.title}>Match Shape To Outline</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🧩 Score: {score}
        </Text>
        <Text style={styles.helper}>
          {targetOutline ? `Tap the ${targetOutline} shape!` : 'Match the shape to the outline!'}
        </Text>
      </View>

      <View style={styles.playArea}>
        {/* Outlines at top */}
        <View style={styles.outlinesContainer}>
          {outlines.map((outline, index) => (
            <View
              key={`outline-${index}`}
              style={[
                styles.outline,
                {
                  borderColor: outline === targetOutline ? '#22C55E' : '#94A3B8',
                  borderWidth: outline === targetOutline ? 4 : 2,
                },
              ]}
            >
              <Text style={styles.outlineEmoji}>{SHAPE_EMOJIS[outline]}</Text>
            </View>
          ))}
        </View>

        {/* Target indicator */}
        {targetOutline && (
          <View style={styles.targetIndicator}>
            <Text style={styles.targetText}>
              Find the {targetOutline}!
            </Text>
          </View>
        )}

        {/* Shapes in random positions */}
        {shapes.map((shape, index) => {
          const shakeTranslateX = shape.shakeAnim.interpolate({
            inputRange: [-10, 10],
            outputRange: [-10, 10],
          });

          return (
            <Animated.View
              key={`shape-${index}`}
              style={[
                styles.shapeContainer,
                {
                  left: `${shape.x}%`,
                  top: `${shape.y}%`,
                  transform: [
                    { scale: shape.scale },
                    { translateX: shakeTranslateX },
                  ],
                },
              ]}
            >
              <Pressable
                onPress={() => handleShapeTap(index)}
                style={[
                  styles.shape,
                  {
                    backgroundColor: shape.type === targetOutline ? '#22C55E' : '#3B82F6',
                    borderColor: shape.type === targetOutline ? '#16A34A' : '#2563EB',
                    borderWidth: shape.type === targetOutline ? 4 : 2,
                  },
                ]}
                disabled={!roundActive || done || isShaking}
              >
                <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS[shape.type]}</Text>
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: spatial reasoning • early puzzle foundation • visual form constancy
        </Text>
        <Text style={styles.footerSub}>
          Match the shape to the outline! This builds spatial reasoning and puzzle skills.
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
  outlinesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 30,
    marginTop: 20,
    marginBottom: 30,
  },
  outline: {
    width: OUTLINE_SIZE,
    height: OUTLINE_SIZE,
    borderRadius: OUTLINE_SIZE / 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  outlineEmoji: {
    fontSize: 70,
    opacity: 0.5,
  },
  targetIndicator: {
    alignItems: 'center',
    marginBottom: 20,
  },
  targetText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#22C55E',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  shapeContainer: {
    position: 'absolute',
    transform: [{ translateX: -SHAPE_SIZE / 2 }, { translateY: -SHAPE_SIZE / 2 }],
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: SHAPE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  shapeEmoji: {
    fontSize: 50,
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
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  savedText: {
    marginTop: 16,
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '600',
  },
});

export default MatchShapeToOutlineGame;


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
    withSpring,
} from 'react-native-reanimated';
import Svg, { Circle, Polygon, Rect } from 'react-native-svg';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const SHAPE_SIZE = 50;
const MATCH_TOLERANCE = 12;

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

type ShapeType = 'circle' | 'square' | 'triangle' | 'hexagon';

interface ShapeConfig {
  type: ShapeType;
  outlineX: number;
  outlineY: number;
  shapeX: number;
  shapeY: number;
}

const ShadowMatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [currentConfig, setCurrentConfig] = useState<ShapeConfig | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const shapeX = useSharedValue(50);
  const shapeY = useSharedValue(30);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const shapeScale = useSharedValue(1);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  const shapes: ShapeType[] = ['circle', 'square', 'triangle', 'hexagon'];

  const generateRound = useCallback(() => {
    const shapeType = shapes[Math.floor(Math.random() * shapes.length)];
    const outlineX = 50 + (Math.random() - 0.5) * 25;
    const outlineY = 65;
    const shapeStartX = 20 + Math.random() * 30;
    const shapeStartY = 25;
    
    setCurrentConfig({
      type: shapeType,
      outlineX,
      outlineY,
      shapeX: shapeStartX,
      shapeY: shapeStartY,
    });
    shapeX.value = shapeStartX;
    shapeY.value = shapeStartY;
    shapeScale.value = 1;
  }, []);

  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'shadowMatch',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-discrimination', 'motor-accuracy', 'shadow-matching'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log shadow match game:', e);
      }

      speakTTS('Shadow matched!', 0.78 );
    },
    [router],
  );

  const checkMatch = useCallback((x: number, y: number) => {
    if (!currentConfig) return false;
    const dist = Math.sqrt(
      Math.pow(x - currentConfig.outlineX, 2) + Math.pow(y - currentConfig.outlineY, 2)
    );
    return dist < MATCH_TOLERANCE;
  }, [currentConfig]);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!roundActive || done || !currentConfig) return;
      setIsDragging(true);
      shapeScale.value = withSpring(1.1, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done || !currentConfig) return;
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;

      shapeX.value = Math.max(5, Math.min(95, newX));
      shapeY.value = Math.max(10, Math.min(90, newY));
    })
    .onEnd(() => {
      if (!roundActive || done || !currentConfig) return;
      setIsDragging(false);
      shapeScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      if (checkMatch(shapeX.value, shapeY.value)) {
        sparkleX.value = currentConfig.outlineX;
        sparkleY.value = currentConfig.outlineY;

        setScore(s => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound(r => r + 1);
              generateRound();
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
        shapeX.value = withSpring(currentConfig.shapeX, { damping: 10, stiffness: 100 });
        shapeY.value = withSpring(currentConfig.shapeY, { damping: 10, stiffness: 100 });
        try {
          playWarning();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS('Match the exact shadow!', 0.78 );
        } catch {}
      }
    });

  useEffect(() => {
    try {
      speakTTS('Match the shape to its exact shadow outline!', 0.78 );
    } catch {}
    generateRound();
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, generateRound]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const shapeStyle = useAnimatedStyle(() => ({
    left: `${shapeX.value}%`,
    top: `${shapeY.value}%`,
    transform: [
      { translateX: -SHAPE_SIZE / 2 },
      { translateY: -SHAPE_SIZE / 2 },
      { scale: shapeScale.value },
    ],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  const renderShape = (type: ShapeType, x: number, y: number, isShadow: boolean = false) => {
    const size = SHAPE_SIZE;
    const fill = isShadow ? '#374151' : '#3B82F6';
    const stroke = isShadow ? '#1F2937' : '#2563EB';
    const strokeWidth = isShadow ? 2 : 2;
    const opacity = isShadow ? 0.5 : 1;

    switch (type) {
      case 'circle':
        return (
          <Circle
            cx={x}
            cy={y}
            r={size / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      case 'square':
        return (
          <Rect
            x={x - size / 2}
            y={y - size / 2}
            width={size}
            height={size}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      case 'triangle':
        return (
          <Polygon
            points={`${x},${y - size / 2} ${x - size / 2},${y + size / 2} ${x + size / 2},${y + size / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
      case 'hexagon':
        const hexPoints = [];
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          hexPoints.push(
            `${x + (size / 2) * Math.cos(angle)},${y + (size / 2) * Math.sin(angle)}`
          );
        }
        return (
          <Polygon
            points={hexPoints.join(' ')}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
          />
        );
    }
  };

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎭</Text>
            <Text style={styles.resultTitle}>Shadow Matched!</Text>
            <Text style={styles.resultSubtitle}>
              You matched {finalStats.correct} shadows out of {finalStats.total}!
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
                generateRound();
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
        <Text style={styles.title}>Shadow Match</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎭 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Match the shape to its exact shadow outline!
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
            <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.svg}>
              {/* Shadow outline */}
              {currentConfig && renderShape(currentConfig.type, currentConfig.outlineX, currentConfig.outlineY, true)}
            </Svg>

            {/* Draggable shape */}
            {currentConfig && (
              <Animated.View style={[styles.shapeContainer, shapeStyle]}>
                <View style={{ width: SHAPE_SIZE, height: SHAPE_SIZE, justifyContent: 'center', alignItems: 'center' }}>
                  <Svg width={SHAPE_SIZE} height={SHAPE_SIZE} viewBox="0 0 100 100">
                    {renderShape(currentConfig.type, 50, 50, false)}
                  </Svg>
                </View>
              </Animated.View>
            )}

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
          Skills: visual discrimination • motor accuracy • shadow matching
        </Text>
        <Text style={styles.footerSub}>
          Match the shape to its exact shadow!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EFF6FF',
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
  svg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  shapeContainer: {
    position: 'absolute',
    zIndex: 3,
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

export default ShadowMatchGame;


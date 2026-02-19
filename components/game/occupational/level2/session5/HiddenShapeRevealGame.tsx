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
import Animated, {
    useAnimatedProps,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const WARNING_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const DOT_RADIUS = 12;

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

interface Dot {
  x: number;
  y: number;
  number: number;
  connected: boolean;
}

const HiddenShapeRevealGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playWarning = useSoundEffect(WARNING_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [currentDotIndex, setCurrentDotIndex] = useState(0);
  const [connections, setConnections] = useState<Array<{ from: number; to: number }>>([]);
  const [dots, setDots] = useState<Dot[]>([]);
  const [shapeRevealed, setShapeRevealed] = useState(false);

  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const shapeOpacity = useSharedValue(0);

  const [currentShapeType, setCurrentShapeType] = useState<'heart' | 'diamond'>('heart');
  const [shapePath, setShapePath] = useState('');

  const generateDots = useCallback(() => {
    const shapes: { type: 'heart' | 'diamond'; dots: Array<{ x: number; y: number }>; path: string }[] = [
      // Heart shape
      {
        type: 'heart',
        dots: [
          { x: 50, y: 60, number: 1 },
          { x: 45, y: 55, number: 2 },
          { x: 40, y: 50, number: 3 },
          { x: 45, y: 45, number: 4 },
          { x: 50, y: 40, number: 5 },
          { x: 55, y: 45, number: 6 },
          { x: 60, y: 50, number: 7 },
          { x: 55, y: 55, number: 8 },
        ],
        path: 'M 50 60 L 45 55 L 40 50 L 45 45 L 50 40 L 55 45 L 60 50 L 55 55 Z',
      },
      // Diamond
      {
        type: 'diamond',
        dots: [
          { x: 50, y: 70, number: 1 },
          { x: 60, y: 50, number: 2 },
          { x: 50, y: 30, number: 3 },
          { x: 40, y: 50, number: 4 },
        ],
        path: 'M 50 70 L 60 50 L 50 30 L 40 50 Z',
      },
    ];
    
    const selectedShape = shapes[Math.floor(Math.random() * shapes.length)];
    const newDots: Dot[] = selectedShape.dots.map(d => ({ ...d, connected: false }));
    setDots(newDots);
    setCurrentShapeType(selectedShape.type);
    setShapePath(selectedShape.path);
    setCurrentDotIndex(0);
    setConnections([]);
    setShapeRevealed(false);
    shapeOpacity.value = 0;
  }, [shapeOpacity]);

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
          type: 'hiddenShapeReveal',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['planning', 'number-sequence', 'shape-reveal'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log hidden shape reveal game:', e);
      }

      speakTTS('Shape revealed!', 0.78 );
    },
    [router],
  );

  const handleDotPress = useCallback((dotNumber: number, dotX: number, dotY: number) => {
    if (!roundActive || done) return;

    if (currentDotIndex === 0 && dotNumber === 1) {
      setDots(prev => prev.map(d => d.number === 1 ? { ...d, connected: true } : d));
      setCurrentDotIndex(1);
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    } else if (currentDotIndex > 0 && dotNumber === currentDotIndex + 1) {
      const prevDot = dots.find(d => d.number === currentDotIndex);
      if (prevDot) {
        setConnections(prev => [...prev, { from: currentDotIndex, to: dotNumber }]);
        setDots(prev => prev.map(d => d.number === dotNumber ? { ...d, connected: true } : d));
        
        if (dotNumber === dots.length) {
          setShapeRevealed(true);
          shapeOpacity.value = withTiming(1, { duration: 500 });
          
          sparkleX.value = dotX;
          sparkleY.value = dotY;
          
          setScore(s => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1500);
            } else {
              setTimeout(() => {
                setRound(r => r + 1);
                generateDots();
                setRoundActive(true);
              }, 2000);
            }
            return newScore;
          });

          try {
            playSuccess();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          } catch {}
        } else {
          setCurrentDotIndex(dotNumber);
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}
        }
      }
    } else {
      try {
        playWarning();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        speakTTS(`Tap dot ${currentDotIndex === 0 ? 1 : currentDotIndex + 1}!`, 0.78 );
      } catch {}
    }
  }, [currentDotIndex, dots, roundActive, done, endGame, playSuccess, playWarning, shapeOpacity]);

  useEffect(() => {
    try {
      speakTTS('Connect the dots in order to reveal the hidden shape!', 0.78 );
    } catch {}
    generateDots();
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, generateDots]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  const animatedPathProps = useAnimatedProps(() => ({
    opacity: shapeOpacity.value,
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>✨</Text>
            <Text style={styles.resultTitle}>Shapes Revealed!</Text>
            <Text style={styles.resultSubtitle}>
              You revealed {finalStats.correct} shapes out of {finalStats.total}!
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
                generateDots();
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
        <Text style={styles.title}>Hidden Shape Reveal</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ✨ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Connect the dots to reveal the hidden shape!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={styles.svg}>
          {connections.map((conn, idx) => {
            const fromDot = dots.find(d => d.number === conn.from);
            const toDot = dots.find(d => d.number === conn.to);
            if (!fromDot || !toDot) return null;
            return (
              <Line
                key={idx}
                x1={fromDot.x}
                y1={fromDot.y}
                x2={toDot.x}
                y2={toDot.y}
                stroke="#EC4899"
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          })}

          {/* Fill shape when complete */}
          {shapeRevealed && shapePath && (
            <AnimatedPath
              d={shapePath}
              fill="#EC4899"
              animatedProps={animatedPathProps}
              style={{ opacity: 0.3 }}
            />
          )}

          {dots.map((dot) => (
            <React.Fragment key={dot.number}>
              <Circle
                cx={dot.x}
                cy={dot.y}
                r={DOT_RADIUS}
                fill={dot.connected ? '#EC4899' : '#E5E7EB'}
                stroke={dot.connected ? '#DB2777' : '#9CA3AF'}
                strokeWidth="2"
              />
              <SvgText
                x={dot.x}
                y={dot.y + 4}
                textAnchor="middle"
                fontSize="10"
                fill={dot.connected ? '#fff' : '#374151'}
                fontWeight="bold"
              >
                {dot.number}
              </SvgText>
            </React.Fragment>
          ))}
        </Svg>

        {dots.map((dot) => (
          <TouchableOpacity
            key={`touch-${dot.number}`}
            onPress={() => handleDotPress(dot.number, dot.x, dot.y)}
            style={{
              position: 'absolute',
              left: `${dot.x}%`,
              top: `${dot.y}%`,
              transform: [{ translateX: -DOT_RADIUS }, { translateY: -DOT_RADIUS }],
              width: DOT_RADIUS * 2,
              height: DOT_RADIUS * 2,
              borderRadius: DOT_RADIUS,
              zIndex: 5,
            }}
            activeOpacity={0.7}
          />
        ))}

        {score > 0 && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}

        {currentDotIndex === 0 && (
          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>Tap dot 1 to reveal! 👆</Text>
          </View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: planning • number sequence • shape reveal
        </Text>
        <Text style={styles.footerSub}>
          Connect dots to reveal the hidden shape!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FDF2F8',
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
  svg: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  shapeFillContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 1,
    pointerEvents: 'none',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  instructionBox: {
    position: 'absolute',
    bottom: '20%',
    left: '50%',
    transform: [{ translateX: -100 }],
    backgroundColor: 'rgba(236, 72, 153, 0.9)',
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

export default HiddenShapeRevealGame;


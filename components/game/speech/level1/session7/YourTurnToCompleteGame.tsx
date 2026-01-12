import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredPieces?: number;
};

const PIECE_SIZE = 80;
const HAND_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;
const PIECE_DELAY_MS = 1500;

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

const PUZZLE_PIECES = [
  { emoji: '🧩', color: ['#3B82F6', '#2563EB'] },
  { emoji: '⭐', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🎈', color: ['#EF4444', '#DC2626'] },
  { emoji: '🌙', color: ['#6366F1', '#4F46E5'] },
  { emoji: '⭐', color: ['#22C55E', '#16A34A'] },
];

export const YourTurnToCompleteGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredPieces = 6,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [piecesPlaced, setPiecesPlaced] = useState(0);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalPieces: number;
    piecesPlaced: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [currentPiece, setCurrentPiece] = useState<number | null>(null);
  const [piecePosition, setPiecePosition] = useState<'left' | 'right' | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [placedPieces, setPlacedPieces] = useState<{ emoji: string; color: string[]; side: 'left' | 'right' }[]>([]);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const pieceX = useRef(new Animated.Value(0)).current;
  const pieceY = useRef(new Animated.Value(0)).current;
  const pieceScale = useRef(new Animated.Value(0)).current;
  const pieceOpacity = useRef(new Animated.Value(0)).current;
  const handLeftScale = useRef(new Animated.Value(1)).current;
  const handRightScale = useRef(new Animated.Value(1)).current;
  const startRoundRef = useRef<(() => void) | undefined>(undefined);

  const handleSystemTurn = useCallback((pieceIndex: number) => {
    const piece = PUZZLE_PIECES[pieceIndex];
    setPlacedPieces(prev => [...prev, { ...piece, side: 'right' }]);
    setPiecesPlaced(prev => prev + 1);

    // Animate hand
    Animated.sequence([
      Animated.timing(handRightScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(handRightScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Hide piece
    Animated.parallel([
      Animated.timing(pieceScale, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(pieceOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => {
        startRoundRef.current?.();
      }, 500);
    });
  }, []);

  const startRound = useCallback(() => {
    if (piecesPlaced >= requiredPieces) {
      finishGame();
      return;
    }

    // Reset
    setCanTap(false);
    pieceScale.setValue(0);
    pieceOpacity.setValue(0);

    // Alternate between left (child) and right (system)
    const isChildTurn = piecesPlaced % 2 === 0;
    const side = isChildTurn ? 'left' : 'right';
    setPiecePosition(side);
    setCanTap(isChildTurn);

    // Select random piece
    const pieceIndex = Math.floor(Math.random() * PUZZLE_PIECES.length);
    setCurrentPiece(pieceIndex);

    // Position piece - adjust for piece center
    const xPos = side === 'left' ? SCREEN_WIDTH * 0.2 - PIECE_SIZE / 2 : SCREEN_WIDTH * 0.8 - PIECE_SIZE / 2;
    const yPos = SCREEN_HEIGHT * 0.4 - PIECE_SIZE / 2;
    pieceX.setValue(xPos);
    pieceY.setValue(yPos);

    // Animate piece appearance
    Animated.parallel([
      Animated.spring(pieceScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(pieceOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    if (isChildTurn) {
      speak('Your turn!');
    } else {
      // System's turn - auto-complete after delay
      setTimeout(() => {
        handleSystemTurn(pieceIndex);
      }, PIECE_DELAY_MS);
    }
  }, [piecesPlaced, requiredPieces, handleSystemTurn]);

  const handlePieceTap = useCallback(() => {
    console.log('Piece tapped!', { canTap, currentPiece, piecePosition });
    if (!canTap || !currentPiece || piecePosition !== 'left') {
      console.log('Tap blocked:', { canTap, currentPiece, piecePosition });
      return;
    }

    setCanTap(false);
    const piece = PUZZLE_PIECES[currentPiece];
    setPlacedPieces(prev => [...prev, { ...piece, side: 'left' }]);
    setPiecesPlaced(prev => prev + 1);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Animate hand
    Animated.sequence([
      Animated.timing(handLeftScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(handLeftScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Hide piece
    Animated.parallel([
      Animated.timing(pieceScale, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(pieceOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);
      setTimeout(() => {
        startRound();
      }, 500);
    });
  }, [canTap, currentPiece, piecePosition, startRound]);

  const finishGame = useCallback(async () => {
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const accuracy = 100;
    const xp = piecesPlaced * 18;

    setFinalStats({
      totalPieces: requiredPieces,
      piecesPlaced,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'your-turn-to-complete',
        correct: piecesPlaced,
        total: requiredPieces,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['alternating-turns', 'visual-discrimination', 'joint-action'],
        meta: {
          piecesPlaced,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [piecesPlaced, requiredPieces, onComplete]);

  // Update ref when startRound changes
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  useEffect(() => {
    // Give clear instructions before starting
    speak('Take turns placing puzzle pieces! I will place one, then it\'s your turn. Tap the piece when it\'s your turn!');
    setTimeout(() => {
      startRound();
    }, 3000);
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
    };
  }, [startRound]);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.piecesPlaced}
        total={finalStats.totalPieces}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          clearScheduledSpeech();
          stopAllSpeech();
          cleanupSounds();
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const piece = currentPiece !== null ? PUZZLE_PIECES[currentPiece] : null;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#E0E7FF', '#C7D2FE']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              stopAllSpeech();
              cleanupSounds();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Your Turn to Complete</Text>
            <Text style={styles.subtitle}>Take turns placing puzzle pieces!</Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Hands */}
          <View style={styles.handsContainer}>
            <Animated.View
              style={[
                styles.hand,
                {
                  left: SCREEN_WIDTH * 0.15,
                  transform: [{ scale: handLeftScale }],
                },
              ]}
            >
              <Text style={styles.handEmoji}>👋</Text>
              <Text style={styles.handLabel}>You</Text>
            </Animated.View>
            <Animated.View
              style={[
                styles.hand,
                {
                  right: SCREEN_WIDTH * 0.15,
                  transform: [{ scale: handRightScale }],
                },
              ]}
            >
              <Text style={styles.handEmoji}>🤖</Text>
              <Text style={styles.handLabel}>System</Text>
            </Animated.View>
          </View>

          {/* Current Piece */}
          {piece && (
            <Animated.View
              style={[
                styles.pieceContainer,
                {
                  transform: [
                    { translateX: pieceX },
                    { translateY: pieceY },
                  ],
                  opacity: pieceOpacity,
                },
              ]}
            >
              <Pressable
                onPress={handlePieceTap}
                disabled={!canTap}
                style={styles.piecePressable}
              >
                <Animated.View
                  style={[
                    styles.piece,
                    {
                      transform: [
                        { scale: pieceScale },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={piece.color as [string, string, ...string[]]}
                    style={styles.pieceGradient}
                  >
                    <Text style={styles.pieceEmoji}>{piece.emoji}</Text>
                  </LinearGradient>
                </Animated.View>
              </Pressable>
            </Animated.View>
          )}

          {/* Placed Pieces Display */}
          <View style={styles.placedContainer}>
            {placedPieces.map((p, idx) => (
              <View
                key={idx}
                style={[
                  styles.placedPiece,
                  {
                    left: p.side === 'left' ? SCREEN_WIDTH * 0.1 : SCREEN_WIDTH * 0.7,
                    top: (SCREEN_HEIGHT || 800) * 0.65 + (idx % 3) * 60,
                  },
                ]}
              >
                <LinearGradient
                  colors={p.color as [string, string, ...string[]]}
                  style={styles.placedPieceGradient}
                >
                  <Text style={styles.placedPieceEmoji}>{p.emoji}</Text>
                </LinearGradient>
              </View>
            ))}
          </View>

          {/* Progress */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              Piece {piecesPlaced + 1} / {requiredPieces}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="repeat" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Alternating Turns</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Visual Discrimination</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="people" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Joint Action</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  handsContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  hand: {
    width: HAND_SIZE,
    height: HAND_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handEmoji: {
    fontSize: 50,
  },
  handLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 4,
  },
  pieceContainer: {
    position: 'absolute',
    width: PIECE_SIZE,
    height: PIECE_SIZE,
    left: 0,
    top: 0,
  },
  piecePressable: {
    width: PIECE_SIZE,
    height: PIECE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  piece: {
    width: PIECE_SIZE,
    height: PIECE_SIZE,
    borderRadius: 16,
  },
  pieceGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pieceEmoji: {
    fontSize: 40,
  },
  placedContainer: {
    position: 'absolute',
    top: '65%',
    left: 0,
    right: 0,
    height: 200,
  },
  placedPiece: {
    width: PIECE_SIZE * 0.7,
    height: PIECE_SIZE * 0.7,
    borderRadius: 12,
    position: 'absolute',
  },
  placedPieceGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placedPieceEmoji: {
    fontSize: 28,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  skillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
});


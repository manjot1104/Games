/**
 * BlowMeter Component
 * Visual indicator showing blow intensity (0-100%)
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type Props = {
  intensity: number; // 0-1
  isBlowing: boolean;
  threshold?: number; // Optional threshold (0-1) to show a marker
};

export default function BlowMeter({ intensity, isBlowing, threshold }: Props) {
  const { width } = useWindowDimensions();
  const animatedWidth = useRef(new Animated.Value(0)).current;
  const isTablet = width >= 768;
  const isMobile = width < 600;

  useEffect(() => {
    Animated.timing(animatedWidth, {
      toValue: intensity,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [intensity]);

  const meterWidth = isTablet ? 400 : isMobile ? 280 : 350;
  const meterHeight = isTablet ? 24 : isMobile ? 16 : 20;
  const thresholdPosition = threshold ? threshold * meterWidth : null;

  // Determine color based on intensity
  const getColor = () => {
    if (threshold && intensity >= threshold) {
      // Special color when threshold is reached
      return ['#10B981', '#059669']; // Bright green when threshold reached
    }
    if (intensity < 0.3) return ['#4ADE80', '#22C55E']; // Green
    if (intensity < 0.6) return ['#FBBF24', '#F59E0B']; // Yellow
    return ['#EF4444', '#DC2626']; // Red
  };

  const colors = getColor();

  return (
    <View style={[styles.container, { width: meterWidth, height: meterHeight }]}>
      <View style={[styles.meterBackground, { width: meterWidth, height: meterHeight }]}>
        {/* Threshold marker line */}
        {thresholdPosition !== null && (
          <View
            style={[
              styles.thresholdMarker,
              {
                left: thresholdPosition - 2,
                height: meterHeight + 4,
              },
            ]}
          />
        )}
        <Animated.View
          style={[
            styles.meterFill,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: [0, meterWidth],
              }),
              height: meterHeight,
            },
          ]}
        >
          <LinearGradient
            colors={colors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
      {isBlowing && (
        <Animated.View
          style={[
            styles.glow,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: [0, meterWidth],
              }),
              height: meterHeight,
              opacity: intensity > 0.3 ? 0.6 : 0,
            },
          ]}
        />
      )}
      {/* Threshold reached indicator */}
      {threshold && intensity >= threshold && (
        <Animated.View
          style={[
            styles.thresholdGlow,
            {
              width: animatedWidth.interpolate({
                inputRange: [0, 1],
                outputRange: [0, meterWidth],
              }),
              height: meterHeight,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  meterBackground: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  meterFill: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    borderRadius: 10,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 8,
  },
  thresholdMarker: {
    position: 'absolute',
    width: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    top: -2,
    zIndex: 10,
    shadowColor: '#FFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 10,
  },
  thresholdGlow: {
    position: 'absolute',
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 10,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 12,
  },
});


/**
 * Camera Consent Component
 * Shows privacy information and requests camera permission
 */

import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CameraConsentProps {
  onAccept: () => void;
  onDecline: () => void;
}

export const CameraConsent: React.FC<CameraConsentProps> = ({ onAccept, onDecline }) => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons name="camera" size={48} color="#3B82F6" />
        </View>
        
        <Text style={styles.title}>Enable Eye Tracking?</Text>
        
        <Text style={styles.description}>
          To measure your attention more accurately, we can track where you're looking using your camera.
        </Text>

        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="shield-checkmark" size={20} color="#22C55E" />
            <Text style={styles.featureText}>
              All processing happens on your device
            </Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="eye-off" size={20} color="#22C55E" />
            <Text style={styles.featureText}>
              No video is stored or sent anywhere
            </Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="lock-closed" size={20} color="#22C55E" />
            <Text style={styles.featureText}>
              Your privacy is protected
            </Text>
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.declineButton]}
            onPress={onDecline}
            activeOpacity={0.8}
          >
            <Text style={styles.declineButtonText}>Skip</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, styles.acceptButton]}
            onPress={onAccept}
            activeOpacity={0.8}
          >
            <Text style={styles.acceptButtonText}>Enable</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.note}>
          You can change this setting anytime during the game
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    maxWidth: 400,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  features: {
    gap: 12,
    marginBottom: 24,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  featureText: {
    fontSize: 14,
    color: '#475569',
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    backgroundColor: '#F1F5F9',
  },
  declineButtonText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '700',
  },
  acceptButton: {
    backgroundColor: '#3B82F6',
  },
  acceptButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  note: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
});






































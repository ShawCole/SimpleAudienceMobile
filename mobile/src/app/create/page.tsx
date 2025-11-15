/**
 * Create Audience Page
 * Wizard-style interface for creating new audiences
 */

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '../../components/layout/header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { Card } from '../../components/ui/card';
import { apiClient } from '../../services/api-client';
import toast from 'react-hot-toast';
import { AudienceFilters } from '../../../../shared/types';
import { ArrowLeft, ArrowRight, MapPin, Target, Sparkles } from 'lucide-react';

type Step = 'name' | 'location' | 'intent' | 'review';

export default function CreateAudiencePage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>('name');
  const [loading, setLoading] = useState(false);

  // Form state
  const [audienceName, setAudienceName] = useState('');
  const [cities, setCities] = useState('');
  const [states, setStates] = useState('');
  const [zipCodes, setZipCodes] = useState('');
  const [intentType, setIntentType] = useState<'custom' | 'ai_generated'>('custom');
  const [customKeywords, setCustomKeywords] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [intentScore, setIntentScore] = useState<'low' | 'medium' | 'high'>('medium');

  const steps: Step[] = ['name', 'location', 'intent', 'review'];
  const stepIndex = steps.indexOf(currentStep);

  const handleNext = () => {
    if (currentStep === 'name' && !audienceName.trim()) {
      toast.error('Please enter an audience name');
      return;
    }

    const nextIndex = stepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = stepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    } else {
      router.push('/');
    }
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      // Build filters
      const filters: AudienceFilters = {};

      // Location filters
      if (cities || states || zipCodes) {
        filters.location = {
          cities: cities ? cities.split(',').map(c => c.trim()) : undefined,
          states: states ? states.split(',').map(s => s.trim()) : undefined,
          zipCodes: zipCodes ? zipCodes.split(',').map(z => z.trim()) : undefined,
        };
      }

      // Intent filters
      if (intentType === 'custom' && customKeywords) {
        filters.intent = {
          type: 'custom',
          keywords: customKeywords.split(',').map(k => k.trim()),
          score: intentScore,
        };
      } else if (intentType === 'ai_generated' && aiPrompt) {
        filters.intent = {
          type: 'ai_generated',
          aiPrompt,
          score: intentScore,
        };
      }

      // Create audience
      const audience = await apiClient.createAudience({
        name: audienceName,
        filters,
      });

      toast.success('Audience created successfully!');
      router.push(`/audience/${audience.id}`);
    } catch (error) {
      console.error('Failed to create audience:', error);
      toast.error('Failed to create audience. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'name':
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Name Your Audience
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Choose a descriptive name for your audience
              </p>
            </div>

            <Input
              label="Audience Name"
              placeholder="e.g., Tech Startups in California"
              value={audienceName}
              onChange={(e) => setAudienceName(e.target.value)}
              autoFocus
            />
          </div>
        );

      case 'location':
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <MapPin className="mx-auto text-primary-600 mb-2" size={48} />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Location Filters
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Define geographic targeting (comma-separated)
              </p>
            </div>

            <Input
              label="Cities"
              placeholder="San Francisco, New York, Austin"
              value={cities}
              onChange={(e) => setCities(e.target.value)}
            />

            <Input
              label="States (2-letter codes)"
              placeholder="CA, NY, TX"
              value={states}
              onChange={(e) => setStates(e.target.value)}
            />

            <Input
              label="ZIP Codes"
              placeholder="94102, 10001, 78701"
              value={zipCodes}
              onChange={(e) => setZipCodes(e.target.value)}
            />

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Leave blank to skip location targeting
            </p>
          </div>
        );

      case 'intent':
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <Target className="mx-auto text-primary-600 mb-2" size={48} />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Intent Targeting
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Define what your audience is interested in
              </p>
            </div>

            {/* Intent Type Selector */}
            <div className="flex gap-2">
              <Button
                variant={intentType === 'custom' ? 'primary' : 'secondary'}
                size="md"
                fullWidth
                onClick={() => setIntentType('custom')}
              >
                Custom Keywords
              </Button>
              <Button
                variant={intentType === 'ai_generated' ? 'primary' : 'secondary'}
                size="md"
                fullWidth
                onClick={() => setIntentType('ai_generated')}
              >
                <Sparkles size={16} className="mr-1" />
                AI Generated
              </Button>
            </div>

            {/* Custom Keywords */}
            {intentType === 'custom' && (
              <Textarea
                label="Keywords (comma-separated)"
                placeholder="cloud computing, SaaS, enterprise software"
                rows={4}
                value={customKeywords}
                onChange={(e) => setCustomKeywords(e.target.value)}
              />
            )}

            {/* AI Prompt */}
            {intentType === 'ai_generated' && (
              <Textarea
                label="Describe your target audience"
                placeholder="Companies looking for cloud-based HR solutions for remote teams..."
                rows={6}
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
            )}

            {/* Intent Score */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Intent Score
              </label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((score) => (
                  <Button
                    key={score}
                    variant={intentScore === score ? 'primary' : 'secondary'}
                    size="sm"
                    fullWidth
                    onClick={() => setIntentScore(score)}
                  >
                    {score.charAt(0).toUpperCase() + score.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Leave blank to skip intent targeting
            </p>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-4">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Review & Create
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                Review your audience configuration
              </p>
            </div>

            <Card padding="md">
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Name</p>
                  <p className="text-base font-medium text-gray-900 dark:text-white">
                    {audienceName}
                  </p>
                </div>

                {(cities || states || zipCodes) && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Location</p>
                    <div className="text-sm text-gray-900 dark:text-white space-y-1">
                      {cities && <p>Cities: {cities}</p>}
                      {states && <p>States: {states}</p>}
                      {zipCodes && <p>ZIP Codes: {zipCodes}</p>}
                    </div>
                  </div>
                )}

                {(customKeywords || aiPrompt) && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Intent</p>
                    <div className="text-sm text-gray-900 dark:text-white space-y-1">
                      {intentType === 'custom' && customKeywords && (
                        <p>Keywords: {customKeywords}</p>
                      )}
                      {intentType === 'ai_generated' && aiPrompt && (
                        <p>AI Prompt: {aiPrompt}</p>
                      )}
                      <p>Score: {intentScore}</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        );
    }
  };

  return (
    <div className="min-h-screen">
      <Header title="Create Audience" showCreateButton={false} />

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {steps.map((step, index) => (
              <div
                key={step}
                className={`flex-1 h-2 rounded-full mx-1 ${
                  index <= stepIndex
                    ? 'bg-primary-600'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
            Step {stepIndex + 1} of {steps.length}
          </p>
        </div>

        {/* Step Content */}
        <div className="mb-8">{renderStepContent()}</div>

        {/* Navigation Buttons */}
        <div className="flex gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={handleBack}
            className="flex items-center"
          >
            <ArrowLeft size={20} className="mr-2" />
            Back
          </Button>

          {currentStep !== 'review' ? (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleNext}
              className="flex items-center justify-center"
            >
              Next
              <ArrowRight size={20} className="ml-2" />
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleSubmit}
              loading={loading}
            >
              Create Audience
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

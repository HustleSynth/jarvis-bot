import OpenAI from 'openai';

export class AiController {
  constructor(config, logger) {
    this.enabled = config.enabled && Boolean(config.apiKey);
    this.logger = logger;
    this.config = config;
    this.history = [];

    if (this.enabled) {
      this.client = new OpenAI({ apiKey: config.apiKey });
      this.logger.info(`AI controller enabled with model ${config.model}`);
    } else {
      this.logger.warn('AI controller disabled - missing API key or AI explicitly disabled');
    }
  }

  appendHistory(role, content) {
    if (!this.enabled) return;
    this.history.push({ role, content });
    if (this.history.length > this.config.maxHistory) {
      this.history = this.history.slice(-this.config.maxHistory);
    }
  }

  async chat(prompt, context = '') {
    if (!this.enabled) {
      return 'AI is disabled.';
    }

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...this.history,
      {
        role: 'user',
        content: context ? `${prompt}\n\nContext:\n${context}`.trim() : prompt,
      },
    ];

    try {
      const response = await this.client.responses.create({
        model: this.config.model,
        input: messages.map((message) => ({ role: message.role, content: message.content })),
      });

      const candidates = [
        response?.output_text,
        response?.data?.[0]?.content?.[0]?.text?.value,
      ].filter(Boolean);
      const text = candidates.map((value) => value.trim()).find((value) => value.length > 0);
      if (text) {
        this.appendHistory('user', prompt);
        this.appendHistory('assistant', text);
        return text;
      }
      return 'AI did not provide a response.';
    } catch (error) {
      this.logger.error('Failed to get AI response', error);
      return `Error from AI: ${error.message}`;
    }
  }
}

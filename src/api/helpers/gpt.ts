/* eslint-disable import/no-extraneous-dependencies */
import 'dotenv/config';
import { Configuration, OpenAIApi } from 'openai';

const prompt = `
  Write a governance proposal (including a catchy title) asking for
  a specific amount of money to complete a task for a web3 protocol organization called juicebox, in a markdown format.
`;

const configuration = new Configuration({
  organization: 'org-NxFbp0TWSjymgDZtDAnugwuG',
  apiKey: process.env.OPENAI_KEY,
});

export async function getProposal() {
  const openai = new OpenAIApi(configuration);

  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt,
    temperature: 0.78,
    max_tokens: 430,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  return completion.data.choices[0].text;
}

export const getProjectName = async () => {
  const openai = new OpenAIApi(configuration);

  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: 'What is the two word name for the project? Only respond with the words and nothing else.',
    temperature: 0.78,
    max_tokens: 10,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  return completion.data.choices[0].text;
};

export const getProjectDescription = async (): Promise<string> => {
  const openai = new OpenAIApi(configuration);

  const completion = await openai.createCompletion({
    model: 'text-davinci-003',
    prompt: 'What is the description of the project?',
    temperature: 0.78,
    max_tokens: 100,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  return completion.data.choices[0].text || 'No description provided.';
};

export const getProjectAvatar = async (input: string) => {
  const openai = new OpenAIApi(configuration);

  const image = await openai.createImage({
    prompt: input,
    n: 1,
    size: '512x512',
    response_format: 'b64_json'
  });
  return image.data.data[0].b64_json || '';
};

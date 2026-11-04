import { builder } from './builder';
import './modules';

/** The assembled Admin schema (same schema is mounted under every API version). */
export const schema = builder.toSchema();

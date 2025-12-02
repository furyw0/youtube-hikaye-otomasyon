import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IProcessLog {
  _id: Types.ObjectId;
  storyId: Types.ObjectId;
  step: string;
  status: 'started' | 'completed' | 'failed';
  message: string;
  metadata?: Record<string, any>;
  duration?: number;
  createdAt: Date;
}

const ProcessLogSchema = new Schema<IProcessLog>(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: 'Story',
      required: true
    },
    step: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['started', 'completed', 'failed'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    metadata: {
      type: Schema.Types.Mixed
    },
    duration: {
      type: Number
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// Indexes
ProcessLogSchema.index({ storyId: 1, createdAt: -1 });
ProcessLogSchema.index({ status: 1 });

const ProcessLog: Model<IProcessLog> = mongoose.models.ProcessLog || mongoose.model<IProcessLog>('ProcessLog', ProcessLogSchema);

export default ProcessLog;


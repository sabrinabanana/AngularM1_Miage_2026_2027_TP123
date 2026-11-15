import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    addresseeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
  },
  { timestamps: true },
);

schema.index({ requesterId: 1, addresseeId: 1 }, { unique: true });

schema.methods.toPublic = function () {
  return {
    id: this.id,
    requesterId: String(this.requesterId),
    addresseeId: String(this.addresseeId),
    status: this.status,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const Friendship = mongoose.model("Friendship", schema);

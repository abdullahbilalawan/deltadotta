export type Delivery = {
  id: string;
  scheduledAt: Date;
  assignedDriverId?: string;
};

export function readyForDispatch(delivery: Delivery) {
  return Boolean(delivery.assignedDriverId)
    && delivery.scheduledAt.getTime() > Date.now();
}


export type GateState={visualsApproved:boolean;renderStatus:"QUEUED"|"PROCESSING"|"SUCCEEDED"|"FAILED";finalApproval:boolean};
export function canPublish(state:GateState){return state.visualsApproved&&state.renderStatus==="SUCCEEDED"&&state.finalApproval}

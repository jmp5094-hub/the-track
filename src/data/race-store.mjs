import {doc,runTransaction} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {createRaceStore as createStore} from '../../functions/race-store.mjs';
export {money,cleanTicket,priceTicket} from '../../functions/race-store.mjs';
export function createRaceStore(db,options){
  const store=createStore({ref:(collection,id)=>doc(db,collection,id),transact:fn=>runTransaction(db,fn)},options);
  return {...store,bid:async(user,race,horse,amount)=>(await httpsCallable(getFunctions(db.app),'placeAuctionBid')({raceId:race.id,horse,amount})).data};
}

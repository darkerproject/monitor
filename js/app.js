(function(){
  "use strict";
  // ---------- estado ----------
  var peer=null,localStream=null,screenStream=null;
  var sharing=false,micOn=true,camOn=true,musicMode=false;
  var selMic="",selCam="",selSpk="",selDaw="";
  var audioCtx=null,role=null,hostId=null,myId=null;
  var dawOn=false,dawStream=null,silentTrack=null,dawMonitorEl=null,dawNodes=null;
  var dawGain=parseFloat(localStorage.getItem("dawGain")||"1")||1;
  var voiceTrack=null,dawSlotTrack=null,screenSlotTrack=null,blankVideoTrack=null,meScreenTile=null,meScreenVideo=null;
  var meters=[],meterRAF=null;
  var peers={}; // id -> {dc, call, name, avatar, index, cam, screen, hasVideo, tile, video, audioEls:[]}
  var myName=localStorage.getItem("myName")||"";
  var myAvatar=localStorage.getItem("myAvatar")||"";
  var myIndex=null; // host=1, invitados reciben el suyo en welcome
  var pending={}; // solicitudes en espera (solo host)
  var awaitingApproval=false;
  var preMicOn=true,preCamOn=true,pendingJoin=null;
  var nextIndex=2;  // solo lo usa el host
  var $=function(id){return document.getElementById(id);};

  // ---------- tema ----------
  function applyTheme(dark){
    document.documentElement.setAttribute("data-theme",dark?"dark":"light");
    $("themeIcon").innerHTML = dark
      ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  }
  var phoneForceDark=window.matchMedia&&window.matchMedia("(max-width:480px)").matches;
  applyTheme(phoneForceDark||(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches));

  function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove("show");},2400);}
  function ensureCtx(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();return audioCtx;}

  // ---------- perfil ----------
  function camVisible(){return camOn;}
  function displayName(name,index){return name||("User "+(index||"?"));}
  function myDisplayName(){return displayName(myName,myIndex);}
  function myProfileMsg(){return {type:"profile",name:myName,avatar:myAvatar,index:myIndex,cam:camVisible(),screen:sharing};}

  // ---------- constraints ----------
  function micConstraints(){
    var c=musicMode?{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2}
                   :{echoCancellation:true,noiseSuppression:true,autoGainControl:true};
    if(selMic)c.deviceId={exact:selMic};
    return c;
  }
  function dawConstraints(){return {deviceId:{exact:selDaw},echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:2};}
  function videoConstraints(){var c={width:{ideal:1280},height:{ideal:720}};if(selCam)c.deviceId={exact:selCam};else c.facingMode="user";return c;}

  // ---------- media ----------
  function getMedia(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints(),video:videoConstraints()}).then(function(s){
      localStream=s;voiceTrack=s.getAudioTracks()[0]||null;
      $("meVideo").srcObject=s;
      registerMeter("meterMic",s);
      return populateDevices();
    });
  }
  function getSilentTrack(){
    if(silentTrack&&silentTrack.readyState==="live")return silentTrack;
    var dst=ensureCtx().createMediaStreamDestination();
    silentTrack=dst.stream.getAudioTracks()[0];
    return silentTrack;
  }
  function getBlankVideoTrack(){
    if(blankVideoTrack&&blankVideoTrack.readyState==="live")return blankVideoTrack;
    var c=document.createElement("canvas");c.width=2;c.height=2;
    c.getContext("2d").fillRect(0,0,2,2);
    blankVideoTrack=c.captureStream(1).getVideoTracks()[0];
    return blankVideoTrack;
  }
  // saliente: [voz, slot DAW, video] — el receptor lee audio[0]=voz, audio[1]=DAW
  function buildOutStream(){
    var out=new MediaStream();
    if(voiceTrack)out.addTrack(voiceTrack);
    dawSlotTrack=(dawOn&&dawNodes)?dawNodes.dst.stream.getAudioTracks()[0]:getSilentTrack();
    out.addTrack(dawSlotTrack);
    var cam=localStream?localStream.getVideoTracks()[0]:null;
    if(cam)out.addTrack(cam);
    screenSlotTrack=(sharing&&screenStream)?screenStream.getVideoTracks()[0]:getBlankVideoTrack();
    out.addTrack(screenSlotTrack);
    return out;
  }

  // ---------- dispositivos ----------
  function populateDevices(){
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      fill($("micSelect"),devs,"audioinput",selMic,null);
      fill($("dawSelect"),devs,"audioinput",selDaw,"— Elegir dispositivo —");
      fill($("camSelect"),devs,"videoinput",selCam,null);
      var hasSink=("setSinkId" in HTMLMediaElement.prototype),spk=$("spkSelect");
      if(hasSink){fill(spk,devs,"audiooutput",selSpk,null);spk.disabled=false;}
      else{spk.innerHTML='<option>No disponible en este navegador</option>';spk.disabled=true;}
      var m=$("micSelect");if(m.selectedOptions[0])$("srcName").textContent=m.selectedOptions[0].textContent;
      var d=$("dawSelect");$("inDawName").textContent=(selDaw&&d.selectedOptions[0])?d.selectedOptions[0].textContent:"Sin dispositivo";
    });
  }
  function fill(sel,devs,kind,cur,placeholder){
    var list=devs.filter(function(d){return d.kind===kind;});sel.innerHTML="";
    if(placeholder){var ph=document.createElement("option");ph.value="";ph.textContent=placeholder;sel.appendChild(ph);}
    list.forEach(function(d,i){var o=document.createElement("option");o.value=d.deviceId;o.textContent=d.label||(kind+" "+(i+1));if(d.deviceId===cur)o.selected=true;sel.appendChild(o);});
    if(!placeholder&&list.length&&!cur)sel.selectedIndex=0;
  }

  // ---------- medidores ----------
  function registerMeter(containerId,stream){
    var cont=$(containerId);
    var entry=meters.filter(function(m){return m.id===containerId;})[0];
    if(!entry){
      entry={id:containerId,segs:[],analyser:null};
      for(var i=0;i<20;i++){var s=document.createElement("div");s.className="seg";cont.appendChild(s);entry.segs.push(s);}
      meters.push(entry);
    }
    try{
      var src=ensureCtx().createMediaStreamSource(stream);
      entry.analyser=audioCtx.createAnalyser();entry.analyser.fftSize=512;
      src.connect(entry.analyser);
      entry.data=new Uint8Array(entry.analyser.fftSize);
    }catch(e){entry.analyser=null;}
    if(!meterRAF)meterLoop();
  }
  function meterLoop(){
    meterRAF=requestAnimationFrame(meterLoop);
    meters.forEach(function(m){
      if(!m.analyser)return;
      m.analyser.getByteTimeDomainData(m.data);
      var sum=0;for(var i=0;i<m.data.length;i++){var x=(m.data[i]-128)/128;sum+=x*x;}
      var level=Math.min(1,Math.sqrt(sum/m.data.length)*3.2),lit=Math.round(level*m.segs.length);
      for(var j=0;j<m.segs.length;j++){
        if(j<lit){var f=j/m.segs.length;m.segs[j].style.background=f>0.85?"#ff453a":f>0.65?"#ff9f0a":"#34c759";}
        else m.segs[j].style.background="var(--fill)";
      }
    });
  }

  // ---------- SDP ----------
  function preferOpusHQ(sdp){
    var pts=[],re=/a=rtpmap:(\d+) opus\/48000/g,m;
    while((m=re.exec(sdp)))if(pts.indexOf(m[1])<0)pts.push(m[1]);
    pts.forEach(function(pt){
      var fre=new RegExp("a=fmtp:"+pt+" ([^\\r\\n]+)","g");
      if(fre.test(sdp)){
        sdp=sdp.replace(fre,function(full,p){
          if(!/stereo=/.test(p))p+=";stereo=1;sprop-stereo=1";
          if(!/maxaveragebitrate=/.test(p))p+=";maxaveragebitrate=256000";
          if(!/maxplaybackrate=/.test(p))p+=";maxplaybackrate=48000";
          return "a=fmtp:"+pt+" "+p;
        });
      } else {
        sdp=sdp.replace(new RegExp("(a=rtpmap:"+pt+" opus\\/48000\\/2)","g"),
          "$1\r\na=fmtp:"+pt+" stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000");
      }
    });
    return sdp;
  }

  // ---------- malla de participantes ----------
  function ensurePeer(id){
    if(peers[id])return peers[id];
    var p={id:id,dc:null,call:null,name:"",avatar:"",index:null,cam:true,screen:false,hasVideo:false,audioEls:[],screenTrack:null,screenTile:null,screenVideo:null};
    peers[id]=p;
    createTile(p);
    updatePeersUI();
    return p;
  }
  function setupData(dc){
    var isApplicant=(role==="host"&&!peers[dc.peer]);
    if(isApplicant){
      pending[dc.peer]={dc:dc,name:"",avatar:"",notified:false};
      updateRequestsUI();
    } else {
      var p=ensurePeer(dc.peer);p.dc=dc;
    }
    dc.on("open",function(){if(!pending[dc.peer])dc.send(myProfileMsg());});
    dc.on("data",function(msg){
      if(!msg||!msg.type)return;
      var req=pending[dc.peer];
      if(req){
        if(msg.type==="profile"){
          req.name=msg.name||"";req.avatar=msg.avatar||"";
          if(!req.notified){req.notified=true;toast((req.name||"Alguien")+" quiere entrar a la sala");}
          updateRequestsUI();
        }
        return; // en espera: no puede hacer nada mas
      }
      handleData(dc.peer,msg);
    });
    dc.on("close",function(){
      if(pending[dc.peer]){delete pending[dc.peer];updateRequestsUI();return;}
      if(role==="guest"&&awaitingApproval){awaitingApproval=false;$("waitTitle").textContent="La sala se cerró";$("waitSub").textContent="Intenta con un enlace nuevo.";return;}
      removePeer(dc.peer);
    });
    dc.on("error",function(){});
  }
  // ---------- solicitudes (host) ----------
  function acceptRequest(id){
    var req=pending[id];if(!req)return;
    delete pending[id];
    var p=ensurePeer(id);
    p.dc=req.dc;p.name=req.name;p.avatar=req.avatar;
    try{
      req.dc.send(myProfileMsg());
      var others=Object.keys(peers).filter(function(k){return k!==id&&peers[k].dc&&peers[k].dc.open;});
      req.dc.send({type:"welcome",peers:others,index:nextIndex++});
    }catch(e){}
    updateTile(p);updateRequestsUI();updatePeersUI();
  }
  function rejectRequest(id){
    var req=pending[id];if(!req)return;
    delete pending[id];
    try{req.dc.send({type:"rejected"});}catch(e){}
    setTimeout(function(){try{req.dc.close();}catch(e){}},400);
    updateRequestsUI();
  }
  function updateHostTopUI(){
    if(role!=="host")return;
    var reqs=Object.keys(pending).length,members=Object.keys(peers).length;
    // el boton de ingresos aparece con la primera solicitud y se queda para siempre
    $("reqCtrl").hidden=!(reqs>0||members>0);
    // el card del enlace se va en cuanto alguien toca la puerta
    document.body.classList.toggle("has-requests",reqs>0);
  }
  function updateRequestsUI(){
    var ids=Object.keys(pending),n=ids.length;
    var c=$("reqCount");c.textContent=n;c.hidden=(n===0);
    $("reqEmpty").style.display=n?"none":"block";
    var list=$("reqList");list.innerHTML="";
    ids.forEach(function(id){
      var r=pending[id];
      var row=document.createElement("div");row.className="person";
      var av=document.createElement("div");av.className="person-av";
      if(r.avatar){var i=document.createElement("img");i.src=r.avatar;av.appendChild(i);}
      else av.textContent=(r.name||"?").trim().charAt(0).toUpperCase();
      var nm=document.createElement("span");nm.className="person-name";nm.textContent=r.name||"Invitado";
      var no=document.createElement("button");no.className="req-reject";no.textContent="Rechazar";
      no.addEventListener("click",function(){rejectRequest(id);});
      var ok=document.createElement("button");ok.className="req-accept";ok.textContent="Aceptar";
      ok.addEventListener("click",function(){acceptRequest(id);});
      row.appendChild(av);row.appendChild(nm);row.appendChild(no);row.appendChild(ok);
      list.appendChild(row);
    });
    updateHostTopUI();
  }
  function handleData(id,msg){
    if(!msg||!msg.type)return;
    var p=ensurePeer(id);
    if(msg.type==="profile"){
      p.name=msg.name||"";p.avatar=msg.avatar||"";
      if(msg.index)p.index=msg.index;
      if(typeof msg.cam==="boolean")p.cam=msg.cam;
      if(typeof msg.screen==="boolean")p.screen=msg.screen;
      if(p.screen)ensurePeerScreenTile(p);
      updateTile(p);updatePeersUI();
    } else if(msg.type==="cam"){
      p.cam=!!msg.on;p.screen=!!msg.screen;if(p.screen)ensurePeerScreenTile(p);updateTile(p);updatePeersUI();
    } else if(msg.type==="welcome"&&role==="guest"){
      if(!myIndex){myIndex=msg.index;broadcast(myProfileMsg());refreshMyUI();}
      (msg.peers||[]).forEach(function(pid){
        if(pid===myId||peers[pid])return;
        connectToPeer(pid); // el recién llegado inicia con cada existente
      });
    }
  }
  function connectToPeer(pid){
    var dc=peer.connect(pid);
    setupData(dc);
    var call=peer.call(pid,buildOutStream(),{sdpTransform:preferOpusHQ});
    setupCall(call);
  }
  function setupCall(call){
    var p=ensurePeer(call.peer);
    p.call=call;
    call.on("stream",function(stream){attachPeerStream(p,stream);});
    call.on("close",function(){removePeer(call.peer);});
    watchConn(call.peerConnection,call.peer);
  }
  function attachPeerStream(p,stream){
    syncPeerVideos(p,stream);
    ensurePeerAudio(p,stream);
    stream.onaddtrack=function(){ensurePeerAudio(p,stream);syncPeerVideos(p,stream);updatePeersUI();};
    updateTile(p);updatePeersUI();
  }
  function syncPeerVideos(p,stream){
    var vt=stream.getVideoTracks();
    if(vt[0]){p.hasVideo=true;p.video.muted=true;p.video.srcObject=new MediaStream([vt[0]]);}
    if(vt[1]){p.screenTrack=vt[1];if(p.screen)ensurePeerScreenTile(p);}
  }
  function ensurePeerScreenTile(p){
    if(p.screenTile||!p.screenTrack)return;
    var t=document.createElement("div");t.className="tile screen-tile";t.hidden=true;
    t.innerHTML='<video autoplay playsinline muted></video><div class="tile-tag"></div>';
    $("grid").appendChild(t);
    p.screenTile=t;p.screenVideo=t.querySelector("video");
    p.screenVideo.srcObject=new MediaStream([p.screenTrack]);
    t.querySelector(".tile-tag").textContent=displayName(p.name,p.index)+" — pantalla";
  }
  function ensurePeerAudio(p,stream){
    stream.getAudioTracks().forEach(function(t,idx){
      if(p.audioEls.some(function(a){return a.dataset.tid===t.id;}))return;
      var a=document.createElement("audio");
      a.autoplay=true;a.srcObject=new MediaStream([t]);
      a.dataset.tid=t.id;a.dataset.kind=idx===0?"voz":"daw";
      document.body.appendChild(a);
      p.audioEls.push(a);
      applySink(a);
      a.play().catch(function(){
        var once=function(){document.querySelectorAll("audio").forEach(function(el){el.play().catch(function(){});});document.removeEventListener("click",once);};
        document.addEventListener("click",once);
        toast("Toca la pantalla para activar el audio");
      });
    });
  }
  function removePeer(id){
    var p=peers[id];if(!p)return;
    delete peers[id];
    try{if(p.call)p.call.close();}catch(e){}
    try{if(p.dc)p.dc.close();}catch(e){}
    p.audioEls.forEach(function(a){try{a.srcObject=null;a.remove();}catch(e){}});
    if(p.tile)p.tile.remove();
    if(p.screenTile)p.screenTile.remove();
    updatePeersUI();
    toast(displayName(p.name,p.index)+" salió");
  }
  function broadcast(msg){
    Object.keys(peers).forEach(function(k){var dc=peers[k].dc;if(dc&&dc.open){try{dc.send(msg);}catch(e){}}});
  }
  function watchConn(pc,pid){
    if(!pc)return;
    pc.onconnectionstatechange=function(){
      var s=pc.connectionState;
      if(s==="connected")updatePeersUI();
      else if(s==="disconnected"||s==="failed")removePeer(pid);
    };
    setTimeout(function(){try{
      pc.getSenders().forEach(function(s){
        if(s.track&&s.track.kind==="audio"){var pr=s.getParameters();if(!pr.encodings)pr.encodings=[{}];pr.encodings[0].maxBitrate=256000;s.setParameters(pr);}
      });
    }catch(e){}},1500);
  }
  function allSenders(){
    var arr=[];
    Object.keys(peers).forEach(function(k){var c=peers[k].call;if(c&&c.peerConnection)arr=arr.concat(c.peerConnection.getSenders());});
    return arr;
  }
  function replaceAcross(oldTrack,newTrack){allSenders().forEach(function(s){if(s.track===oldTrack)try{s.replaceTrack(newTrack);}catch(e){}});}

  // ---------- tiles ----------
  function watchAspect(v){
    var upd=function(){v.classList.toggle("portrait",v.videoHeight>v.videoWidth);};
    v.addEventListener("loadedmetadata",upd);v.addEventListener("resize",upd);
  }
  function createTile(p){
    var t=document.createElement("div");t.className="tile";
    t.innerHTML='<video autoplay playsinline muted></video><div class="tile-off show"><img class="tile-avatar" alt=""><span class="tile-name-big"></span></div><div class="tile-tag"></div>';
    $("grid").appendChild(t);
    p.tile=t;p.video=t.querySelector("video");watchAspect(p.video);
    updateTile(p);
  }
  function updateTile(p){
    if(!p.tile)return;
    var off=p.tile.querySelector(".tile-off"),img=p.tile.querySelector(".tile-avatar"),big=p.tile.querySelector(".tile-name-big"),tag=p.tile.querySelector(".tile-tag");
    var name=displayName(p.name,p.index);
    tag.textContent=name;
    var visible=p.hasVideo&&p.cam;
    off.classList.toggle("show",!visible);
    if(p.avatar){img.src=p.avatar;img.style.display="block";big.style.display="none";}
    else{img.style.display="none";big.style.display="block";big.textContent=name;}
    if(p.screenTile)p.screenTile.querySelector(".tile-tag").textContent=name+" — pantalla";
  }
  function updateMyTile(){
    var t=$("meTile");
    var off=t.querySelector(".tile-off"),img=t.querySelector(".tile-avatar"),big=t.querySelector(".tile-name-big"),tag=t.querySelector(".tile-tag");
    tag.textContent=myDisplayName()+" (tú)";
    var visible=camVisible();
    off.classList.toggle("show",!visible);
    if(myAvatar){img.src=myAvatar;img.style.display="block";big.style.display="none";}
    else{img.style.display="none";big.style.display="block";big.textContent=myDisplayName();}
    $("meVideo").classList.add("mirror");
  }
  function applyLayout(){
    var g=$("grid");
    var ids=Object.keys(peers);
    var total=ids.length+1; // solo cámaras
    var sharerScreen=null;
    if(sharing&&meScreenTile)sharerScreen=meScreenTile;
    else{for(var i=0;i<ids.length;i++){var pp=peers[ids[i]];if(pp.screen&&pp.screenTile){sharerScreen=pp.screenTile;break;}}}
    var screenTiles=[meScreenTile].concat(ids.map(function(k){return peers[k].screenTile;})).filter(Boolean);
    screenTiles.forEach(function(t){t.hidden=(t!==sharerScreen);});
    document.body.classList.remove("layout-solo","layout-duo","layout-grid","layout-share");
    var cams=[$("meTile")].concat(ids.map(function(k){return peers[k].tile;})).filter(Boolean);
    cams.concat(screenTiles).forEach(function(t){t.classList.remove("big","strip","center-span");t.style.removeProperty("--i");});
    g.classList.toggle("solo",total===1&&!sharerScreen);
    g.style.gridTemplateColumns="";g.style.removeProperty("--cols");
    if(sharerScreen){
      document.body.classList.add("layout-share");
      sharerScreen.classList.add("big");
      cams.forEach(function(t,i){t.classList.add("strip");t.style.setProperty("--i",i);});
      g.style.gridTemplateColumns="repeat("+Math.max(cams.length,1)+",1fr)"; // fila inferior en teléfono
    } else if(total===1){
      document.body.classList.add("layout-solo");
    } else if(total===2){
      document.body.classList.add("layout-duo");
    } else {
      document.body.classList.add("layout-grid");
      var cols=total<=4?2:3;
      g.style.gridTemplateColumns="repeat("+cols+",1fr)";
      g.style.setProperty("--cols",cols);
      if(total%cols===1)$("meTile").classList.add("center-span");
    }
  }
  function updatePeersUI(){
    var n=Object.keys(peers).length;
    document.body.classList.toggle("has-remote",n>0);
    $("grid").classList.toggle("solo",n===0);
    $("peopleCount").textContent=n+1;
    // lista del panel Personas
    var list=$("peopleList");list.innerHTML="";
    var mkRow=function(name,avatar,me){
      var r=document.createElement("div");r.className="person";
      var av=document.createElement("div");av.className="person-av";
      if(avatar){var i=document.createElement("img");i.src=avatar;av.appendChild(i);}
      else av.textContent=(name||"?").trim().charAt(0).toUpperCase();
      var nm=document.createElement("span");nm.className="person-name";nm.textContent=name+(me?" (tú)":"");
      r.appendChild(av);r.appendChild(nm);list.appendChild(r);
    };
    mkRow(myDisplayName(),myAvatar,true);
    Object.keys(peers).forEach(function(k){var p=peers[k];mkRow(displayName(p.name,p.index),p.avatar,false);});
    updateMyTile();
    applyLayout();
    updateHostTopUI();
  }
  function refreshMyUI(){
    $("nameInput").value=myName;
    var av=$("myAvatar");
    av.innerHTML="";
    if(myAvatar){var i=document.createElement("img");i.src=myAvatar;av.appendChild(i);}
    else{av.textContent=(myDisplayName()).trim().charAt(0).toUpperCase();}
    updatePeersUI();
  }

  // ---------- salida / sink ----------
  function applySink(el){if(selSpk&&el.setSinkId)el.setSinkId(selSpk).catch(function(){});}
  function applySinkAll(){
    Object.keys(peers).forEach(function(k){peers[k].audioEls.forEach(applySink);});
    if(dawMonitorEl)applySink(dawMonitorEl);
  }

  function enterRoom(){$("home").style.display="none";$("room").classList.add("show");}
  // ---------- previews del pre-join ----------
  var preMicStream=null,preCamStream=null;
  function startMicPreview(){
    navigator.mediaDevices.getUserMedia({audio:micConstraints()}).then(function(s){
      preMicStream=s;ensureCtx();
      $("preMeterWrap").classList.add("show");
      registerMeter("meterPre",s);
    }).catch(function(){preMicOn=false;$("preMicSw").classList.remove("on");toast("No se pudo acceder al micrófono");});
  }
  function stopMicPreview(){
    if(preMicStream){preMicStream.getTracks().forEach(function(t){t.stop();});preMicStream=null;}
    var m=meters.filter(function(x){return x.id==="meterPre";})[0];if(m)m.analyser=null;
    $("preMeterWrap").classList.remove("show");
  }
  function startCamPreview(){
    navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
      preCamStream=s;$("preCamVideo").srcObject=s;$("preCamWrap").classList.add("show");
    }).catch(function(){preCamOn=false;$("preCamSw").classList.remove("on");toast("No se pudo acceder a la cámara");});
  }
  function stopCamPreview(){
    if(preCamStream){preCamStream.getTracks().forEach(function(t){t.stop();});preCamStream=null;}
    $("preCamVideo").srcObject=null;$("preCamWrap").classList.remove("show");
  }
  function applyInitialAV(){
    if(voiceTrack)voiceTrack.enabled=micOn;
    if(localStream)localStream.getVideoTracks().forEach(function(t){t.enabled=camOn;});
    $("micCtrl").classList.toggle("off",!micOn);
    $("micLbl").textContent=micOn?"Mic":"Silenc.";
    $("camCtrl").classList.toggle("off",!camOn);
  }

  // ---------- inicio ----------
  function initHostPeer(){
    if(peer)return;
    peer=new Peer(undefined,{debug:1});
    peer.on("open",function(id){
      myId=id;hostId=id;
      var url=location.origin+location.pathname+"#"+id;
      $("shareLink").value=url;$("shareLink2").value=url;
    });
    peer.on("connection",setupData);
    peer.on("call",function(c){if(!peers[c.peer]||!localStream){try{c.close();}catch(e){}return;}c.answer(buildOutStream(),{sdpTransform:preferOpusHQ});setupCall(c);});
    peer.on("error",function(e){toast("Error: "+e.type);});
  }
  function startHost(){
    role="host";myIndex=1;document.body.classList.add("role-host");
    var b=$("startBtn");b.disabled=true;b.textContent="Pidiendo permisos…";
    ensureCtx();
    initHostPeer();
    getMedia().then(function(){
      applyInitialAV();
      enterRoom();refreshMyUI();
    }).catch(permsError);
  }
  function joinGuest(hid){
    role="guest";hostId=hid;document.body.classList.add("role-guest");
    ensureCtx();
    getMedia().then(function(){
      awaitingApproval=true;
      $("waitingCard").hidden=false;
      refreshMyUI();
      peer=new Peer(undefined,{debug:1});
      peer.on("open",function(id){
        myId=id;
        var url=location.origin+location.pathname+"#"+hid;
        $("shareLink").value=url;$("shareLink2").value=url;
        var dc=peer.connect(hid);setupData(dc);
      });
      peer.on("connection",setupData);
      peer.on("call",function(c){c.answer(buildOutStream(),{sdpTransform:preferOpusHQ});setupCall(c);});
      peer.on("error",function(e){
        if(e.type==="peer-unavailable"){$("waitTitle").textContent="No se encontró la sala";$("waitSub").textContent="El enlace puede haber expirado. Pide uno nuevo.";}
        else toast("Error: "+e.type);
      });
    }).catch(permsError);
  }
  function permsError(err){
    var msg=(err&&err.name==="NotAllowedError")?"Permiso denegado. Activa cámara y micrófono.":(err&&err.name==="NotFoundError")?"No se encontró cámara o micrófono.":"No se pudo acceder a los dispositivos.";
    toast(msg);var b=$("startBtn");if(b){b.disabled=false;b.textContent="Iniciar sala";}
  }

  // ---------- DAW ----------
  function startDaw(){
    if(!selDaw){openSheet("sheet");toast("Elige la entrada del DAW");return;}
    navigator.mediaDevices.getUserMedia({audio:dawConstraints()}).then(function(s){
      dawStream=s;dawOn=true;
      var ctx=ensureCtx();
      var src=ctx.createMediaStreamSource(s);
      var g=ctx.createGain();g.gain.value=dawGain;
      var dst=ctx.createMediaStreamDestination();
      src.connect(g);g.connect(dst);
      dawNodes={src:src,gain:g,dst:dst};
      var newTrack=dst.stream.getAudioTracks()[0];
      replaceAcross(dawSlotTrack,newTrack);
      dawSlotTrack=newTrack;
      if(!dawMonitorEl){dawMonitorEl=document.createElement("audio");dawMonitorEl.autoplay=true;document.body.appendChild(dawMonitorEl);}
      dawMonitorEl.srcObject=dst.stream;
      applySink(dawMonitorEl);
      dawMonitorEl.play().catch(function(){});
      $("dawRow").style.display="block";
      var dsel=$("dawSelect");$("dawSrcName").textContent=dsel.selectedOptions[0]?dsel.selectedOptions[0].textContent:"";
      registerMeter("meterDaw",dst.stream);
      $("inDawSw").classList.add("on");
      s.getAudioTracks()[0].onended=stopDaw;
      toast("Audio del DAW activado");
    }).catch(function(){toast("No se pudo capturar la entrada del DAW");$("inDawSw").classList.remove("on");});
  }
  function stopDaw(){
    if(!dawOn)return;
    dawOn=false;
    var silent=getSilentTrack();
    replaceAcross(dawSlotTrack,silent);
    dawSlotTrack=silent;
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    dawStream=null;
    if(dawNodes){try{dawNodes.src.disconnect();dawNodes.gain.disconnect();dawNodes.dst.stream.getTracks().forEach(function(t){t.stop();});}catch(e){}dawNodes=null;}
    if(dawMonitorEl)dawMonitorEl.srcObject=null;
    $("dawRow").style.display="none";
    var dm=meters.filter(function(m){return m.id==="meterDaw";})[0];if(dm)dm.analyser=null;
    $("inDawSw").classList.remove("on");
    toast("Audio del DAW desactivado");
  }
  function toggleDaw(){if(dawOn)stopDaw();else startDaw();}

  // ---------- mic / cam / pantalla ----------
  function notifyCam(){broadcast({type:"cam",on:camOn,screen:sharing});}
  function toggleMic(){
    micOn=!micOn;if(voiceTrack)voiceTrack.enabled=micOn;
    $("micCtrl").classList.toggle("off",!micOn);
    $("micLbl").textContent=micOn?"Mic":"Silenc.";
  }
  function toggleCam(){
    camOn=!camOn;localStream.getVideoTracks().forEach(function(t){t.enabled=camOn;});
    $("camCtrl").classList.toggle("off",!camOn);
    updateMyTile();notifyCam();
  }
  function ensureMeScreenTile(){
    if(meScreenTile)return;
    meScreenTile=document.createElement("div");meScreenTile.className="tile screen-tile";
    meScreenTile.innerHTML='<video autoplay playsinline muted></video><div class="tile-tag">Tu pantalla</div>';
    $("grid").appendChild(meScreenTile);
    meScreenVideo=meScreenTile.querySelector("video");
  }
  function toggleScreen(){
    if(!sharing){
      navigator.mediaDevices.getDisplayMedia({video:true}).then(function(s){
        screenStream=s;var tr=s.getVideoTracks()[0];
        replaceAcross(screenSlotTrack,tr);screenSlotTrack=tr;
        ensureMeScreenTile();
        meScreenVideo.srcObject=s;
        sharing=true;
        $("inScreenSw").classList.add("on");$("inScreenName").textContent="Compartiendo";
        closeSheets();
        tr.onended=stopScreen;
        updatePeersUI();notifyCam();
      }).catch(function(){toast("No se compartió la pantalla");});
    } else stopScreen();
  }
  function stopScreen(){
    if(!sharing)return;
    sharing=false;
    var blank=getBlankVideoTrack();
    replaceAcross(screenSlotTrack,blank);screenSlotTrack=blank;
    if(meScreenVideo)meScreenVideo.srcObject=null;
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});
    screenStream=null;
    $("inScreenSw").classList.remove("on");$("inScreenName").textContent="Inactivo";
    updatePeersUI();notifyCam();
  }

  // ---------- swaps ----------
  function reacquireMic(){
    return navigator.mediaDevices.getUserMedia({audio:micConstraints()}).then(function(s){
      var nt=s.getAudioTracks()[0];
      replaceAcross(voiceTrack,nt);
      if(voiceTrack){voiceTrack.stop();localStream.removeTrack(voiceTrack);}
      localStream.addTrack(nt);voiceTrack=nt;nt.enabled=micOn;
      registerMeter("meterMic",new MediaStream([nt]));
    });
  }
  function swapCamera(){
    return navigator.mediaDevices.getUserMedia({video:videoConstraints()}).then(function(s){
      var nt=s.getVideoTracks()[0];
      var old=localStream.getVideoTracks()[0];
      if(old)replaceAcross(old,nt);
      $("meVideo").srcObject=s;
      localStream.getVideoTracks().forEach(function(t){t.stop();localStream.removeTrack(t);});
      localStream.addTrack(nt);nt.enabled=camOn;
    });
  }
  function hangUp(){
    Object.keys(peers).forEach(function(k){try{peers[k].call&&peers[k].call.close();peers[k].dc&&peers[k].dc.close();}catch(e){}});
    Object.keys(pending).forEach(function(k){try{pending[k].dc.close();}catch(e){}});
    if(peer)peer.destroy();
    if(localStream)localStream.getTracks().forEach(function(t){t.stop();});
    if(screenStream)screenStream.getTracks().forEach(function(t){t.stop();});
    if(dawStream)dawStream.getTracks().forEach(function(t){t.stop();});
    if(meterRAF)cancelAnimationFrame(meterRAF);
    location.hash="";location.reload();
  }

  // ---------- avatar ----------
  function setAvatarFromFile(file){
    if(!file||!/^image\//.test(file.type)){toast("Elige una imagen");return;}
    var r=new FileReader();
    r.onload=function(){
      var img=new Image();
      img.onload=function(){
        var c=document.createElement("canvas");c.width=c.height=128;
        var x=c.getContext("2d");
        var s=Math.min(img.width,img.height);
        x.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,128,128);
        myAvatar=c.toDataURL("image/jpeg",0.82);
        try{localStorage.setItem("myAvatar",myAvatar);}catch(e){}
        refreshMyUI();broadcast(myProfileMsg());
      };
      img.src=r.result;
    };
    r.readAsDataURL(file);
  }

  // ---------- sheets ----------
  var sheetIds=["sheet","peopleSheet","inputsSheet","prejoinSheet","reqSheet"];
  function openSheet(id){
    sheetIds.forEach(function(s){$(s).classList.toggle("show",s===id);});
    $("scrim").classList.add("show");
  }
  function closeSheets(){
    sheetIds.forEach(function(s){$(s).classList.remove("show");});
    $("scrim").classList.remove("show");
  }

  // ---------- wiring ----------
  document.addEventListener("DOMContentLoaded",function(){
    $("faqBtn").addEventListener("click",function(){closeSheets();$("faqPage").hidden=false;});
    $("faqClose").addEventListener("click",function(){$("faqPage").hidden=true;});
    $("themeBtn").addEventListener("click",function(){applyTheme(document.documentElement.getAttribute("data-theme")!=="dark");});
    $("startBtn").addEventListener("click",function(){
      pendingJoin="host";
      role="host";
      initHostPeer();
      $("prejoinGo").textContent="Iniciar sala";
      openSheet("prejoinSheet");
      if(preMicOn)startMicPreview();
      if(preCamOn)startCamPreview();
    });
    $("preMicRow").addEventListener("click",function(){preMicOn=!preMicOn;$("preMicSw").classList.toggle("on",preMicOn);ensureCtx();if(preMicOn)startMicPreview();else stopMicPreview();});
    $("preCamRow").addEventListener("click",function(){preCamOn=!preCamOn;$("preCamSw").classList.toggle("on",preCamOn);if(preCamOn)startCamPreview();else stopCamPreview();});
    $("prejoinGo").addEventListener("click",function(){
      micOn=preMicOn;camOn=preCamOn;
      stopMicPreview();stopCamPreview();
      closeSheets();
      if(pendingJoin==="host")startHost();
      else if(pendingJoin)joinGuest(pendingJoin);
      pendingJoin=null;
    });

    var copyFn=function(inputId,btnId){
      var i=$(inputId);i.select();i.setSelectionRange(0,99999);
      var ok=function(){var b=$(btnId);b.textContent="Copiado";b.classList.add("ok");setTimeout(function(){b.textContent="Copiar";b.classList.remove("ok");},1600);};
      if(navigator.clipboard)navigator.clipboard.writeText(i.value).then(ok,ok);else{document.execCommand("copy");ok();}
    };
    $("copyBtn").addEventListener("click",function(){copyFn("shareLink","copyBtn");});
    $("copyBtn2").addEventListener("click",function(){copyFn("shareLink2","copyBtn2");});

    $("micCtrl").addEventListener("click",toggleMic);
    $("devicesCtrl").addEventListener("click",function(){openSheet("inputsSheet");});
    $("camCtrl").addEventListener("click",toggleCam);
    $("peopleCtrl").addEventListener("click",function(){openSheet("peopleSheet");});
    $("reqCtrl").addEventListener("click",function(){openSheet("reqSheet");});
    $("gearCtrl").addEventListener("click",function(){openSheet("sheet");});
    $("hangCtrl").addEventListener("click",hangUp);
    $("scrim").addEventListener("click",function(){if($("prejoinSheet").classList.contains("show"))return;closeSheets();});

    $("inScreenRow").addEventListener("click",toggleScreen);
    $("inDawRow").addEventListener("click",toggleDaw);

    $("micSelect").addEventListener("change",function(){selMic=this.value;$("srcName").textContent=this.selectedOptions[0].textContent;reacquireMic().catch(function(){toast("No se pudo cambiar el micrófono");});});
    $("dawSelect").addEventListener("change",function(){
      selDaw=this.value;
      var d=this.selectedOptions[0];$("inDawName").textContent=selDaw&&d?d.textContent:"Sin dispositivo";
      if(!selDaw){if(dawOn)stopDaw();return;}
      if(dawOn){stopDaw();startDaw();} else {startDaw();closeSheets();}
    });
    $("camSelect").addEventListener("change",function(){selCam=this.value;swapCamera().catch(function(){toast("No se pudo cambiar la cámara");});});
    $("spkSelect").addEventListener("change",function(){selSpk=this.value;applySinkAll();});
    $("musicRow").addEventListener("click",function(){musicMode=!musicMode;$("musicSw").classList.toggle("on",musicMode);reacquireMic().then(function(){toast(musicMode?"Modo música activado":"Modo música desactivado");}).catch(function(){});});

    // ganancia del DAW (card + ajustes, sincronizados)
    function setDawGain(pct){
      pct=Math.max(0,Math.min(400,Math.round(pct)));
      dawGain=pct/100;
      if(dawNodes)dawNodes.gain.gain.value=dawGain;
      ["dawGainSlider","dawGainSlider2"].forEach(function(id){var el=$(id);if(el&&+el.value!==pct)el.value=pct;});
      ["dawGainVal","dawGainVal2"].forEach(function(id){var el=$(id);if(el)el.textContent=pct+"%";});
      localStorage.setItem("dawGain",String(dawGain));
    }
    setDawGain(dawGain*100);
    ["dawGainSlider","dawGainSlider2"].forEach(function(id){
      var el=$(id);if(el)el.addEventListener("input",function(){setDawGain(this.value);});
    });

    // perfil
    $("nameInput").addEventListener("input",function(){
      myName=this.value.slice(0,24);
      try{localStorage.setItem("myName",myName);}catch(e){}
      updatePeersUI();broadcast(myProfileMsg());
    });
    $("myAvatar").addEventListener("click",function(){$("avatarFile").click();});
    $("avatarFile").addEventListener("change",function(){if(this.files&&this.files[0])setAvatarFromFile(this.files[0]);this.value="";});

    if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
      navigator.mediaDevices.addEventListener("devicechange",function(){populateDevices();});
    }

    watchAspect($("meVideo"));

    var hash=location.hash.replace(/^#/,"");
    if(hash){pendingJoin=hash;$("prejoinGo").textContent="Entrar a la sala";openSheet("prejoinSheet");if(preMicOn)startMicPreview();if(preCamOn)startCamPreview();}
  });
})();

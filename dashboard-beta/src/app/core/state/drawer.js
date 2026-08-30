//---------------------------------------------------------------------------
//WHAT A WORKSPACE'S DRAWER IS CALLED.
//
//ITS OWN FILE BECAUSE THREE THINGS NEED IT AND TWO OF THEM CANNOT SHARE. ./main
//builds the path, ./server hands the same name out when there is no main half
//behind it, and ../../bootstrap names the folder for a workspace that is not
//open yet — it is setting one up.
//
//./server COULD NOT SIMPLY ASK ./main. They are in different bundles: main is
//the process that never reloads, server is rebuilt on every save, and requiring
//one from the other would pull the whole main half into the server bundle. So
//the constant is here, where both can reach it and neither owns it.
//
//A SECOND SPELLING OF THIS IS THE BUG IT EXISTS TO STOP: a stand-in answering
//`.okc` while the real one had moved would read an empty workspace as a working
//one, and write into a folder nothing else looks at.
module.exports = '.okc';
